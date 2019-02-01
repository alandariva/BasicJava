import * as util from "./Util";
import * as Ast from "./Ast";
import * as Runtime from "./Runtime";
import * as Native from "./Native";
import * as Listener from "./Listener";
import { BasicJavaVisitor, BaseBasicJavaParser, BasicJavaLexer } from "./antlr/index";
import { RuleNode } from "antlr4/tree/Tree";
import { CommonTokenStream, InputStream } from "antlr4";

export class ParserException extends util.Exception {

}

export class TypeNotResolvedException extends ParserException {

}

export class ArgumentsResolvedException extends ParserException {

}

export class LookingNonStaticInStatic extends ParserException {

}

export interface WhoIsTrying {
    baseClass: Runtime.BaseClass;
    variable?: Runtime.Variable;
}

export class ParserError {
    sourceRange: util.ISourceRange;
    file: string;
    message: string;
}

export class CompileParserException extends ParserException implements util.IExceptionSourceRange {
    protected sourceRange: util.ISourceRange;
    protected file: string;

    constructor(message: string, sourceRange: util.ISourceRange, file: string) {
        super(message);
        this.sourceRange = sourceRange;
        this.file = file;
    }

    getSourceRange(): util.ISourceRange {
        return this.sourceRange;
    }

    getMessage(): string {
        return this.message;
    }

    getFile(): string {
        return this.file;
    }

    getFormatedMessage(): string {
        let message = this.message + " no arquivo " + this.file
        if (this.sourceRange != null) {
            message += " linha " + this.sourceRange.startLine
                + " coluna " + this.sourceRange.startColumn;
        }
        return message;
    }
}

class VerifyMethodsListener extends Listener.BaseListener {
    parser: BasicJavaParser;
    program: Runtime.Program;
    currentScope: Runtime.BaseScope = null;
    methodScope: Runtime.BaseScope = null;
    currentMethod: Runtime.BaseMethod = null;
    scopeStack: Array<Runtime.BaseScope> = [];

    constructor(parser: BasicJavaParser, userClass: Runtime.UserClass) {
        super(userClass);
        this.parser = parser;
        this.program = this.userClass.getProgram();
    }

    setCurrentScope(scope: Runtime.BaseScope): void {
        this.currentScope = scope;
        this.scopeStack.push(scope);
    }

    exitCurrentScope(): void {
        this.scopeStack.pop();
        this.currentScope = this.scopeStack[this.scopeStack.length - 1];
    }

    enterMethod(node: Runtime.UserMethod): void {
        let scope = new Runtime.LocalScope(
            node.isStatic() ? node.getOwnerClass() : node.getOwnerClass().tempObjectScope,
            node.getOwnerClass(),
            node.isStatic());

        this.methodScope = scope;
        this.currentMethod = node;
        this.setCurrentScope(scope);
    }

    exitMethod(node: Runtime.UserMethod): void {
        this.exitCurrentScope();
        this.methodScope = null;
        this.currentMethod = null;
    }

    enterBlockStatement(node: Ast.BlockStatement): void {
        let scope = new Runtime.LocalScope(
            this.currentScope,
            this.currentScope.ownerClass,
            this.currentScope.staticContext);

        this.setCurrentScope(scope);
        node.parseScope = scope;
    }

    exitBlockStatement(node: Ast.BlockStatement): void {
        this.exitCurrentScope();
    }

    enterArgumentDeclaration(node: Runtime.ArgumentDeclaration): void {
        let variable = new Runtime.Variable(node.name, node.type);
        variable.isStatic = this.currentScope.staticContext;
        this.currentScope.defineVariable(variable);
    }

    exitVariableDeclaration(node: Ast.VariableDeclaration): void {
        let type = this.parser.resolveTypeSafe(node.type, node);

        if (type == null) {
            return;
        }

        let variable = new Runtime.Variable(
            node.name,
            type
        );
        variable.isStatic = this.currentScope.staticContext;

        this.defineVariable(node.sourceRange, variable);

        if (node.getInitializer()) {
            let valueType = this.resolveExpressionType(node.getInitializer());
            this.verifyTypeCompability(variable, valueType, node);
        }
    }

    exitStatementExprNode(node: Ast.ExprNode): void {
        this.parser.resolveExpressionType(
            {baseClass: this.currentScope.ownerClass},
            node,
            null,
            this.currentScope);

        // Para ser um statement válido ele precisa ser uma atribuicão ou chamada de método
        if (node instanceof Ast.BinaryExpr) {
            if (!util.Operators.isAssignmentOperator(node.operator)) {
                this.parser.addParserErrorNode("Operador " + node.operator + " não permitido aqui", node);
            }
        } else if (node instanceof Ast.MethodOrVariable) {
            let methodOrVar = node.getMethodOrVariable();
            if (methodOrVar == null) {
                this.parser.addParserErrorNode(
                    "Deve ser uma chamada de método",
                    node
                );
                return;
            }
            while (methodOrVar.getMethodOrVariable() != null) {
                methodOrVar = methodOrVar.getMethodOrVariable()
            }

            if (methodOrVar instanceof Ast.MethodCall == false) {
                this.parser.addParserErrorNode(
                    "Deve ser uma chamada de método",
                    node
                );
            }
        } else if (node instanceof Ast.UnaryExpr) {
            if (node.operator != '++' && node.operator != '--') {
                this.parser.addParserErrorNode(
                    "Isto não é um comando",
                    node
                );
            }
        } else {
            this.parser.addParserErrorNode(
                "Isto não é um comando",
                node
            );
        }
    }

    enterIfStatement(node: Ast.IfStatement): void {
        let type = this.resolveExpressionType(node.getCondition());
        if (type != null && type.getTypeName() != 'boolean') {
            this.parser.addParserErrorNode(
                "A condição deve resultar em uma boleana ",
                node.getCondition()
            );
        }
    }

    enterReturnStatement(node: Ast.ReturnStatement): void {
        if (this.currentMethod.isConstructor) {
            if (node.getExpression() != null) {
                this.parser.addParserErrorNode(
                    "O construtor não pode retornar nenhum valor",
                    node
                );
            }
        } else {
            let type: Runtime.Type;
            if (node.getExpression() != null) {
                type = this.resolveExpressionType(node.getExpression());
            } else {
                type = this.program.resolveType('void');
            }

            if (type != null && type.isCompatible(this.currentMethod.getReturnType()) == false) {
                this.parser.addParserErrorNode(
                    "O tipo de retorno é incompatível com " + this.currentMethod.getReturnType().getTypeName(),
                    node
                );
            }
        }
    }

    enterForStatement(node: Ast.ForStatement): void {
        let scope = new Runtime.LocalScope(
            this.currentScope,
            this.currentScope.ownerClass,
            this.currentScope.staticContext);

        this.setCurrentScope(scope);

        // ForInit
        let nodeForInit = node.getForInit();
        if (nodeForInit instanceof Ast.ExprNode) {
            this.resolveExpressionType(nodeForInit);
        } else if (nodeForInit instanceof Ast.VariableDeclaration) {
            this.exitVariableDeclaration(nodeForInit);
        }

        if (node.getExpression() != null) {
            let type = this.resolveExpressionType(node.getExpression());
            if (type != null && type.getTypeName() != 'boolean') {
                this.parser.addParserErrorNode(
                    "A condição deve resultar em uma boleana ",
                    node.getExpression()
                );
            }
        }

        let nodeExpressionList = node.getExpressionList();
        if (nodeExpressionList.length > 0) {
            for (let i = 0; i < nodeExpressionList.length; i++) {
                this.resolveExpressionType(nodeExpressionList[i]);
            }
        }
    }

    enterWhileStatement(node: Ast.WhileStatement): void {
        this.resolveExpressionType(node.getExpression());

        if (node.getExpression() != null) {
            let type = this.resolveExpressionType(node.getExpression());
            if (type != null && type.getTypeName() != 'boolean') {
                this.parser.addParserErrorNode(
                    "A condição deve resultar em uma boleana ",
                    node.getExpression()
                );
            }
        }
    }

    exitForStatement(node: Ast.ForStatement): void {
        this.exitCurrentScope();
    }

    enterSuperCall(node: Ast.SuperCall): void {
        if (this.currentMethod.isConstructor == false) {
            this.parser.addParserError(
                "Não é possível chamar o construtor super em uma função que não é construtora",
                node.fileName,
                node.sourceRange
            );
        } else {
            if (this.statementIdx != 1) {
                this.parser.addParserError(
                    "O construtor super deve ser chamado como primeiro parâmetro",
                    node.fileName,
                    node.sourceRange
                );
            }
        }
    }

    exitSysout(node: Ast.Sysout) {
        if (node.getExpression()) {
            this.resolveExpressionType(node.getExpression());
        }
    }

    lastStatement(node: Ast.Statement): void {
        if ((this.currentMethod.isConstructor == false)
            && (node instanceof Ast.ReturnStatement == false)
            && (this.currentMethod.getReturnType() != null)
            && (this.currentMethod.getReturnType().getTypeName() != 'void')) {
            this.parser.addParserErrorNode(
                "O último comando deste método deve ser return",
                node
            );
        }
    }

    hasNoStatement(): void {
        if ((this.currentMethod.isConstructor == false)
            && (this.currentMethod.getReturnType() != null)
            && (this.currentMethod.getReturnType().getTypeName() != 'void')) {
            if (this.currentMethod instanceof Runtime.UserMethod) {
                this.parser.addParserErrorNode(
                    "O último comando deste método deve ser return",
                    this.currentMethod.getMethodDeclaration()
                );
            }
        }
    }

    verifyTypeCompability(variable: Runtime.Variable, type: Runtime.Type, node: Ast.BaseNode): void {
        if (type != null && type.isCompatible(variable.type) == false) {
            this.parser.addParserError(
                "Tipo " + type.getTypeName() + " não é compatível com " + variable.type.getTypeName(),
                node.fileName,
                node.sourceRange
            );
        }
    }

    defineVariable(range: util.ISourceRange, variable: Runtime.Variable, scope: Runtime.BaseScope = this.currentScope): void {
        try {
            // Antes de setar variável, verificar se não existe já uma no escopo do método
            let declaredVariable = this.currentScope.resolveVariableSafe(variable.name, this.methodScope);
            if (declaredVariable == null) {
                scope.defineVariable(variable);
            } else {
                this.parser.addParserError(
                    'A variável ' + variable.name + ' já está definida no método',
                    this.userClass.getClassDeclaration().fileName,
                    range
                );
            }
        } catch (ex) {
            if (ex instanceof ParserException) {
                this.parser.addParserError(
                    ex.message,
                    this.userClass.getClassDeclaration().fileName,
                    range
                );
            } else {
                throw ex;
            }
        }
    }

    resolveExpressionType(node: Ast.ExprNode): Runtime.Type {
        try {
            return this.parser.resolveExpressionType({baseClass: this.userClass}, node, null, this.currentScope);
        } catch (ex) {
            if (ex instanceof ParserException) {
                this.parser.addParserError(
                    ex.message,
                    this.userClass.getClassDeclaration().fileName,
                    node.sourceRange
                );
            } else {
                throw ex;
            }
        }
    }
}

/**
 * Classe responsável por criar a estrutura árvore do código.
 */
export class TreeConstructorVisitor extends BasicJavaVisitor {
    fileName: string;

    constructor(fileName: string) {
        super();

        this.fileName = fileName;
    }

    visit(ctx: any): any {
        return super.visit(ctx);
    }

    visitCompilationUnit(ctx: any): Ast.ClassDeclaration {
        if (ctx.classDeclaration().stop != null) {
            return this.visitClassDeclaration(ctx.classDeclaration());
        }

        return null;
    }

    visitClassDeclaration(ctx: any): Ast.ClassDeclaration {
        let node = new Ast.ClassDeclaration(ctx, this.fileName);
        node.name = ctx.Identifier().getText();

        if (ctx.classExtend() != null) {
            node.extend = ctx.classExtend().Identifier().getText();
        }

        let declarations: Array<any> = ctx.classBody().classBodyDeclaration();

        // Cria métodos e propriedades da classe
        for (let i = 0; i < declarations.length; i++) {
            let member = this.visitClassBodyDeclaration(declarations[i]);
            node.addMember(member);
        }

        return node;
    }

    visitClassBodyDeclaration(ctx: any): Ast.BaseNode {
        if (ctx.fieldDeclaration() != null) {
            return this.visitFieldDeclaration(ctx);
        } else if (ctx.methodDeclaration() != null) {
            return this.visitMethodDeclaration(ctx);
        }

        return null;
    }

    visitFieldDeclaration(ctx: any): Ast.VariableDeclaration {
        let node = new Ast.VariableDeclaration(ctx, this.fileName);

        node.name = ctx.fieldDeclaration().Identifier().getText();
        node.type = this.resolveType(ctx.fieldDeclaration().type());

        if (ctx.ClassMemberAccessModifier() != null) {
            node.accessModifier = util.stringToAccessModifier(ctx.ClassMemberAccessModifier().getText());
        } else {
            node.accessModifier = util.AccessModifier.Public;
        }

        if (ctx.ClassMemberModifier() != null) {
            node.isStatic = true;
        }

        if (ctx.fieldDeclaration().variableInitializer() != null) {
            node.setInitializer(this.visitVariableInitializer(ctx.fieldDeclaration().variableInitializer()));
        }

        return node;
    }

    visitMethodDeclaration(ctx: any): Ast.MethodDeclaration {
        let node = new Ast.MethodDeclaration(ctx, this.fileName);

        node.name = ctx.methodDeclaration().Identifier().getText();

        // Verifica se método é estático
        if (ctx.ClassMemberModifier() != null) {
            node.isStatic = true;
        }

        // Trata tipo de retorno do método
        if (ctx.methodDeclaration().type() != null) {
            node.type = this.resolveType(ctx.methodDeclaration().type());
        } else if (ctx.methodDeclaration().voidT() != null) {
            node.type = 'void';
        }

        // Trata tipo de acesso do método
        if (ctx.ClassMemberAccessModifier() != null) {
            node.accessModifier = util.stringToAccessModifier(ctx.ClassMemberAccessModifier().getText());
        } else {
            node.accessModifier = util.AccessModifier.Public;
        }

        // Trata parâmetros
        if (ctx.methodDeclaration().formalParameters().formalParameterList() != null) {
            let parameters = ctx.methodDeclaration().formalParameters()
                .formalParameterList()
                .parameterDeclaration();

            for (let i = 0; i < parameters.length; i++) {
                let argument = new Ast.ArgumentDeclaration(parameters[i], this.fileName);
                argument.type = this.resolveType(parameters[i].type());
                argument.name = parameters[i].Identifier().getText();
                node.addArgument(argument);
            }
        }

        if (ctx.methodDeclaration().block()) {
            node.setBlockStatement(this.visitBlock(ctx.methodDeclaration().block()));
        }
        return node;
    }

    visitBlock(ctx: any): Ast.BlockStatement {
        let node = new Ast.BlockStatement(ctx, this.fileName);
        let blockStatements = ctx.blockStatement();

        for (let i = 0; i < blockStatements.length; i++) {
            let statementNode = this.visitBlockStatement(blockStatements[i]);

            if (statementNode != null) {
                node.addStatement(statementNode);
            }
        }

        return node;
    }

    visitBlockStatement(ctx: any): Ast.Statement {
        if (ctx.systemOutPrint() != null) {
            return this.visitSystemOutPrint(ctx.systemOutPrint());
        } else if (ctx.variableDeclaration() != null) {
            return this.visitVariableDeclaration(ctx.variableDeclaration());
        } else if (ctx.superCall() != null) {
            return this.visitSuperCall(ctx.superCall());
        } else if (ctx.expression() != null) {
            return this.visitExpression(ctx.expression());
        } else if (ctx.ifStatement() != null) {
            return this.visitIfStatement(ctx.ifStatement());
        } else if (ctx.whileStatement() != null) {
            return this.visitWhileStatement(ctx.whileStatement());
        } else if (ctx.forStatement() != null) {
            return this.visitForStatement(ctx.forStatement());
        } else if (ctx.block() != null) {
            return this.visitBlock(ctx.block());
        } else if (ctx.returnStatement() != null) {
            return this.visitReturnStatement(ctx.returnStatement());
        } else if (ctx.basicDebug() != null) {
            let node = new Ast.BasicDebug(ctx, this.fileName);
            return node;
        } else {
            console.error('AST: statement não reconhecido', ctx);
            return null;
        }
    }

    visitWhileStatement(ctx: any): Ast.WhileStatement {
        let node = new Ast.WhileStatement(ctx, this.fileName);
        node.setExpression(this.visitExpression(ctx.expression()));
        node.setStatement(this.visitBlockStatement(ctx.blockStatement()));
        return node;
    }

    visitForStatement(ctx: any): Ast.ForStatement {
        let node = new Ast.ForStatement(ctx, this.fileName);

        if (ctx.forInit() != null) {
            if (ctx.forInit().variableDeclaration() != null) {
                node.setForInit(this.visitVariableDeclaration(ctx.forInit().variableDeclaration()));
            } else {
                node.setForInit(this.visitExpression(ctx.forInit().expression()));
            }
        }

        if (ctx.expression() != null) {
            node.setExpression(this.visitExpression(ctx.expression()));
        }

        if (ctx.expressionList() != null) {
            let expressionList = ctx.expressionList();
            let expressions = expressionList.expression();
            for (let i = 0; i < expressions.length; i++) {
                node.addExpressionList(this.visitExpression(expressions[i]));
            }
        }

        node.setStatement(this.visitBlockStatement(ctx.blockStatement()));

        return node;
    }

    visitReturnStatement(ctx: any): Ast.ReturnStatement {
        let node = new Ast.ReturnStatement(ctx, this.fileName);
        if (ctx.expression() != null) {
            node.setExpression(this.visitExpression(ctx.expression()));
        }
        return node;
    }

    visitIfStatement(ctx: any): Ast.IfStatement {
        let statements = ctx.blockStatement();
        let node = new Ast.IfStatement(ctx, this.fileName);
        node.setCondition(this.visitExpression(ctx.parExpression().expression()));
        node.setStatementsIf(this.visitBlockStatement(statements[0]));
        if (statements.length > 1) {
            node.setStatementsElse(this.visitBlockStatement(statements[1]));
        }
        return node;
    }

    visitSuperCall(ctx: any): Ast.SuperCall {
        let node = new Ast.SuperCall(ctx, this.fileName);
        node.setArgs(this.visitArguments(ctx.arguments()));
        return node;
    }

    // ----------------------------------------------------
    // -- INICIO DOS STATEMENTS
    // ----------------------------------------------------

    visitSystemOutPrint(ctx: any): Ast.Statement {
        let node = new Ast.Sysout(ctx, this.fileName);
        if (ctx.getChild(0).getText() == 'System.out.print(') {
            node.newLine = false;
        }
        if (ctx.expression() != null) {
            node.setExpression(this.visitExpression(ctx.expression()));
        }
        return node;
    }

    visitVariableDeclaration(ctx: any): Ast.Statement {
        let node = new Ast.VariableDeclaration(ctx, this.fileName);

        node.name = ctx.Identifier().getText();
        node.type = this.resolveType(ctx.type());
        if (ctx.variableInitializer() != null) {
            node.setInitializer(this.visitExpression(
                ctx.variableInitializer().expression()
            ));
        }

        return node;
    }

    // ----------------------------------------------------
    // -- FIM DOS STATEMENTS
    // ----------------------------------------------------

    visitArguments(ctx: any): Array<Ast.ExprNode> {
        let args = [];
        let expressionList = ctx.expressionList();
        if (expressionList != null) {
            let expressions = expressionList.expression();
            for (let i = 0; i < expressions.length; i++) {
                args.push(this.visitExpression(expressions[i]));
            }
        }
        return args;
    }

    visitVariableInitializer(ctx: any): Ast.ExprNode {
        return this.visitExpression(ctx.expression());
    }

    visitStatementMethodOrVariable(ctx: any): Ast.MethodOrVariable {
        let node = new Ast.MethodOrVariable(ctx, this.fileName);
        node.thisOrSuper = (ctx.superOrThis() != null) ? ctx.superOrThis().getText() : null;
        if (ctx.methodOrVariableSuffix() != null) {
            let methodVar = this.visitMethodOrVariableSuffix(ctx.methodOrVariableSuffix());
            if (methodVar != null) {
                node.setMethodOrVariable(methodVar);
            }
        } else {
            node.thisOrSuper = 'this';
        }
        return node;
    }

    visitMethodOrVariableSuffix(ctx: any): Ast.MethodOrVariableAccessor {
        if (ctx.Identifier() == null) {
            return null;
        }

        if (ctx.arguments() != null) { // é a chamada de um método
            let node = new Ast.MethodCall(ctx, this.fileName);
            node.name = ctx.Identifier().getText();
            node.setArgs(this.visitArguments(ctx.arguments()));
            // Verificar recursivamente se existem mais acessos
            if (ctx.methodOrVariableSuffix() != null) {
                let methodOrVar = this.visitMethodOrVariableSuffix(ctx.methodOrVariableSuffix());
                if (methodOrVar != null) {
                    node.setMethodOrVariable(methodOrVar);
                }
            }
            return node;
        }

        // chamada de uma variável
        let node = new Ast.Variable(ctx, this.fileName);
        node.name = ctx.Identifier().getText();

        // Verificar recursivamente se existem mais acessos
        if (ctx.methodOrVariableSuffix() != null) {
            let methodOrVar = this.visitMethodOrVariableSuffix(ctx.methodOrVariableSuffix());
            if (methodOrVar != null) {
                node.setMethodOrVariable(methodOrVar);
            }
        }

        return node;
    }

    visitExpression(ctx: any): Ast.ExprNode {
        if (ctx.primary() != null) {
            let node = new Ast.PrimitiveExprNode(ctx, this.fileName);
            if (ctx.primary().Integer()) {
                node.value = parseInt(ctx.primary().Integer().getText());
                node.type = 'int';
            } else if (ctx.primary().BooleanLiteral()) {
                node.value = (ctx.primary().BooleanLiteral().getText() == 'true') ? true : false;
                node.type = 'boolean';
            } else if (ctx.primary().FloatingPointLiteral()) {
                node.value = parseFloat(ctx.primary().FloatingPointLiteral().getText());
                node.type = 'double';
            } else if (ctx.primary().StringLiteral()) {
                node.value = eval(ctx.primary().StringLiteral().getText());
                node.type = 'String';
            } else if (ctx.primary().getText() == 'null') {
                node.value = null;
                node.type = 'null';
            } else {
                throw new util.NotImplementedException("Tipo primitivo não implementado");
            }
            return node;
        } else if (ctx.creator() != null) {
            let node = new Ast.NewExprNode(ctx, this.fileName);
            node.className = ctx.creator().Identifier().getText();
            node.setArgs(this.visitArguments(ctx.creator().arguments()));
            return node;
        } else if (ctx.methodOrVariable() != null) {
            return this.visitStatementMethodOrVariable(ctx.methodOrVariable());
        } else if (ctx.getChildCount() == 3) {
            if (ctx.getChild(1) instanceof RuleNode == false) {
                let operation = new Ast.BinaryExpr(ctx, this.fileName);
                operation.operator = ctx.getChild(1).getText();
                operation.setLeft(this.visitExpression(ctx.expression()[0]));
                operation.setRight(this.visitExpression(ctx.expression()[1]));
                return operation;
            } else {
                return this.visitExpression(ctx.expression()[0]);
            }
        } else if (ctx.getChildCount() == 2) {
            if (ctx.getChild(0).getText() == '-'
                || ctx.getChild(0).getText() == '+'
                || ctx.getChild(0).getText() == '++'
                || ctx.getChild(0).getText() == '--'
                || ctx.getChild(0).getText() == '!'
                || ctx.getChild(1).getText() == '++'
                || ctx.getChild(1).getText() == '--') {

                let operation = new Ast.UnaryExpr(ctx, this.fileName);
                if (ctx.getChild(1).getText() == '++' || ctx.getChild(1).getText() == '--') {
                    operation.operator = ctx.getChild(1).getText();
                    operation.modOperator = 'd';
                } else {
                    operation.operator = ctx.getChild(0).getText();
                }
                operation.setElem(this.visitExpression(ctx.expression()[0]));
                return operation;
            }
        }
        // TODO:0 Implementar os outros tipos de expressão

        console.error(ctx, "exp não implementada");
        return null;
    }

    resolveType(ctx: any): string {
        if (ctx.primitiveType() != null) {
            return ctx.primitiveType().getText();
        }

        return ctx.Identifier().getText();
    }

}

/**
 * Clase que faz o parse dos arquivos e análise semântica.
 */
export class BasicJavaParser {
    private program: Runtime.Program;
    private errors: Array<ParserError> = [];

    parse(codes: { [id: string]: string }): Runtime.Program {
        let classesDeclaration: Array<Ast.ClassDeclaration> = []; // Array com todas as classes

        for (let code in codes) {
            classesDeclaration.push(this.generateAst(code, codes[code]));
        }

        return this.parseClasses(classesDeclaration);
    }

    parseClasses(classesDeclaration: Array<Ast.ClassDeclaration>) {
        this.program = new Runtime.Program();
        this.defineNativeTypes();

        let classes: Array<Runtime.BaseClass> = [];

        let nativeClasses = this.program.getClasses();
        for (let className in nativeClasses) {
            classes.push(nativeClasses[className]);
        }

        // Identifica todas as classes
        for (let i = 0; i < classesDeclaration.length; i++) {
            let userClass = new Runtime.UserClass(this.program, classesDeclaration[i]);
            if (this.program.defineType(userClass) == false) {
                this.addParserErrorNode("O tipo " + userClass.getTypeName() + " já foi definido",
                    userClass.getClassDeclaration());
            } else {
                classes.push(userClass);
            }
        }

        // Seta superclasse e define métodos
        for (let i = 0; i < classes.length; i++) {
            if (classes[i] instanceof Runtime.UserClass) {
                let userClass = classes[i] as Runtime.UserClass;

                userClass.getClassDeclaration().parseScope = userClass;

                // Seta super classe, já que na primeira etapa nem
                // todas as classes eram conhecidas.
                this.setSuperClass(userClass);

                // Definir os métodos das classe.
                // É importante ainda não identificar as variáveis por que elas devem
                // ser criadas na ordem do pai para o filho (ordem correta de execução)
                this.defineMethods(userClass);
            } else {
                this.setSuperClass(classes[i]);
            }
        }

        // Verifica estenção cíclica
        for (let i = 0; i < classes.length; i++) {
            let baseClass = classes[i];

            if (baseClass instanceof Runtime.UserClass) {
                let baseClassTemp: Runtime.BaseClass = baseClass;
                while (baseClassTemp != null) {
                    baseClassTemp = baseClassTemp.getExtendedClass();
                    // Se chegou na mesma classe de partida é uma estenção ciclica
                    if (baseClassTemp != null && baseClassTemp.getTypeName() == baseClass.getTypeName()) {
                        this.addParserErrorNode("Estenção ciclica", baseClass.getClassDeclaration());
                        baseClass.setExtendedClass(null);
                        break;
                    }
                }
            }
        }

        this.program.updateClassesDiscovered();

        // Verifica a sobrescrita dos métodos e define as variáveis da classe/objeto
        {
            let it = new Runtime.ClassRootIterator(classes);

            while (it.hasNext()) {
                let classProcessing = it.next();

                let isRootClass = classProcessing.getExtendedClass() == null;

                // Classes nativas não precisam ser verificadas
                if (classProcessing instanceof Runtime.UserClass) {
                    this.verifyOverriddenMethods(classProcessing, isRootClass);
                    this.defineVariables(classProcessing);
                } else {
                    classProcessing.tempObjectScope = new Runtime.ObjectValue(classProcessing);
                }
            }
        }

        // Verifica se os construtores são válidos
        {
            let it = new Runtime.ClassRootIterator(classes);

            while (it.hasNext()) {
                let classProcessing = it.next();

                if (classProcessing instanceof Runtime.UserClass) {
                    this.verifyConstructors(classProcessing);
                }
            }
        }

        // Verifica se as variáveis da classe estão corretamente declaradas
        for (let i = 0; i < classes.length; i++) {
            let baseClass = classes[i];

            if (baseClass instanceof Runtime.UserClass) {
                this.verifyVariables(baseClass);
                this.verifyMethods(baseClass);
            }
        }

        return this.program;
    }

    resolveType(typeName: string): Runtime.Type {
        return this.program.resolveType2(typeName);
    }

    resolveTypeSafe(typeName: string, node: Ast.BaseNode): Runtime.Type {
        let type = this.program.resolveType2(typeName);
        if (typeof type == 'undefined') {
            this.addParserErrorNode(
                "O tipo " + typeName + " não foi definido",
                node
            );
            type = null;
        }

        return type;
    }

    private verifyVariables(classProcessing: Runtime.UserClass): void {
        // Testando atributos da classe ou objeto
        let variables = classProcessing.getVariables();

        for (let nomeVar in variables) {
            let variable = variables[nomeVar];

            // Só precisa verificar se existe uma atribuição
            if (variable.initializerNode != null) {
                let whoIsTrying = {
                    "baseClass": classProcessing,
                    "variable": variable
                };

                let scope = variable.isStatic ? classProcessing : classProcessing.tempObjectScope;
                let type = this.resolveExpressionType(whoIsTrying, variable.initializerNode, null, scope);

                if (type != null) {
                    if (type.isCompatible(variable.type) == false) {
                        this.addParserErrorNode(
                            "Tipo " + type.getTypeName() +
                            " não é compatível com " + variable.type.getTypeName(),
                            variable.variableDeclaration != null ? variable.variableDeclaration : classProcessing.getClassDeclaration()
                        );
                    }
                }
            }
        }
    }

    /**
     * Verifica se os métodos que foram sobrescritos são válidos.
     * @param {Runtime.UserClass} classProcessing
     * @param {boolean}           isRootClass
     */
    private verifyOverriddenMethods(classProcessing: Runtime.UserClass, isRootClass: boolean): void {
        // Classes root não tem o que sobrescrever
        if (isRootClass) {
            return;
        }

        let methods = classProcessing.getMethods();

        for (let i = 0; i < methods.length; i++) {
            let baseMethodExtended: Runtime.BaseMethod = null;
            let classTemp: Runtime.BaseClass = classProcessing;

            // Procura recursivamente pelo método mais próximo com a mesma assinatura
            while (classTemp.getExtendedClass() != null) {
                baseMethodExtended = classTemp.getExtendedClass()
                    .getMethodBySignature(methods[i].getMethodSignature());
                if (baseMethodExtended != null) {
                    break;
                }
                classTemp = classTemp.getExtendedClass();
            }

            // Se achou o método sobrescrito
            if (baseMethodExtended instanceof Runtime.BaseMethod) {
                // Verificação quanto ao nível de acesso
                if (baseMethodExtended.getAccessModifier() < methods[i].getAccessModifier()) {
                    this.addParserErrorNode(
                        "Método " + methods[i].getMethodSignature() + " não pode ter um modificador de acesso mais restrito"
                        + " que o já definido por uma super classe",
                        classProcessing.getClassDeclaration()
                    );
                }

                // Verificação quanto ao atributo estático
                if (baseMethodExtended.isStatic() != methods[i].isStatic()) {
                    this.addParserErrorNode(
                        "Método " + methods[i].getMethodSignature() + " não pode sobrescrever"
                        + " um método " + (baseMethodExtended.isStatic() ? 'estático' : 'não estático'),
                        classProcessing.getClassDeclaration()
                    );
                }
            }

        }
    }

    private verifyMethods(classProcessing: Runtime.UserClass): void {
        let methods = classProcessing.getMethods();

        // TODO: utilizar um listener começando pelo método (incluindo) até o fim dele
        // desta forma verificar escopo (verificar todas as expressões)
        let listener = new VerifyMethodsListener(this, classProcessing);
        listener.walk();
    }

    private verifyConstructors(classProcessing: Runtime.UserClass): void {
        let constructors = classProcessing.getConstructors();

        // Se não possúi construtores, deve ter um padrão
        if (constructors.length == 0) {
            let methodDec = new Ast.MethodDeclaration(classProcessing.getClassDeclaration().ctx, classProcessing.getClassDeclaration().fileName);
            methodDec.name = classProcessing.getTypeName();
            methodDec.setArguments([]);
            methodDec.setBlockStatement(new Ast.BlockStatement(classProcessing.getClassDeclaration().ctx, classProcessing.getClassDeclaration().fileName));

            let userMethod = new Runtime.UserMethod(
                methodDec,
                [],
                null
            );

            classProcessing.addConstructor(userMethod);
        }

        // Verifica se construtores chamam super() válido
        if (classProcessing.getExtendedClass() != null) {
            for (let j = 0; j < constructors.length; j++) {
                let constructor = constructors[j];

                // Só é necessário validar em métodos escritos pelo usuário
                if (constructor instanceof Runtime.UserMethod) {
                    let statement = constructor.getMethodDeclaration().getBlockStatement().getStatements()[0];

                    // Caso o primeiro statement não for um super(),
                    // garante que o primeiro statement será chamada super()
                    if ((statement instanceof Ast.SuperCall) == false) {
                        if (classProcessing.getExtendedClass().hasConstructor([])) {
                            // Se existe construtor padrão na classe pai, sem problemas
                            constructor.getMethodDeclaration().getBlockStatement().addStatementTop(
                                new Ast.SuperCall(constructor.getMethodDeclaration().ctx, constructor.getMethodDeclaration().fileName)
                            );
                        } else {
                            // Não existe construtor padrão, então o usuário deve informar
                            // os parâmetros corretos
                            this.addParserError(
                                "O construtor da classe pai deve ser chamado pois não existe construtor padrão",
                                classProcessing.getTypeName(),
                                constructor.getMethodDeclaration().sourceRange
                            );
                            continue; // Vai para próximo construtor
                        }
                    }

                    // Agora este statement é um Ast.SuperCall e será
                    // verificado se a lista de argumentos é válida
                    statement = constructor.getMethodDeclaration().getBlockStatement().getStatements()[0];
                    if (statement instanceof Ast.SuperCall) { // Checagem devido ao typescript
                        // Está sendo utilizado escopo pai como o da classe por que variáveis do objeto não podem
                        // ser usadas
                        let localScope = new Runtime.LocalScope(classProcessing, classProcessing, false);

                        // Define parâmetros no escopo
                        let constructorArgs = constructor.getArguments();
                        constructorArgs.forEach(function (v) {
                            let variable = new Runtime.Variable(v.name, v.type);
                            localScope.defineVariable(variable);
                        });

                        let args = this.resolveListExpressionType(
                            {baseClass: classProcessing},
                            statement.getArgs(),
                            null,
                            localScope);

                        if (args != null) {
                            let calledConstructor = classProcessing.getExtendedClass().getConstructor(args);

                            if (calledConstructor == null) {
                                this.addParserErrorNode(
                                    "Não existe construtor "
                                    + Runtime.generateMethodSignature(
                                    classProcessing.getExtendedClass().getTypeName(),
                                    args),
                                    statement
                                );
                                continue;
                            }

                            // Verifica acesso
                            if (calledConstructor.getAccessModifier() == util.AccessModifier.Private) {
                                this.addParserErrorNode(
                                    "O construtor " + calledConstructor.getMethodSignature() + " é privado",
                                    statement
                                );
                                continue;
                            }
                        }
                    }
                }
            }
        } else {
            // Se for classe root não pode super()
            for (let j = 0; j < constructors.length; j++) {
                let constructor = constructors[j];

                if (constructor instanceof Runtime.UserMethod) {
                    if (constructor.getMethodDeclaration().getBlockStatement() == null) {
                        return;
                    }
                    let statement = constructor.getMethodDeclaration().getBlockStatement().getStatements()[0];
                    if (typeof statement != 'undefined' && statement instanceof Ast.SuperCall) {
                        this.addParserError(
                            "Não existe classe pai para ser invocada",
                            classProcessing.getTypeName(),
                            constructor.getMethodDeclaration().sourceRange
                        );
                    }
                }
            }
        }
    }

    addParserError(message: string, file: string, sourceRange: util.ISourceRange): void {
        let parserError = new ParserError();
        parserError.message = message;
        parserError.file = file;
        parserError.sourceRange = sourceRange;
        this.errors.push(parserError);
    }

    addParserErrorNode(message: string, node: Ast.BaseNode): void {
        this.addParserError(message, node.fileName, node.sourceRange);
    }

    getParserErrors(): Array<ParserError> {
        return this.errors;
    }

    resolveExpressionType(whoIsTrying: WhoIsTrying, node: Ast.ExprNode, scopeResolver: Runtime.ScopeResolver, scope: Runtime.BaseScope): Runtime.Type {
        if (node instanceof Ast.PrimitiveExprNode) {
            node.runtimeType = this.resolveTypeSafe(node.type, node);
            return node.runtimeType;
        } else if (node instanceof Ast.NewExprNode) {
            let baseClass = this.resolveTypeSafe(node.className, node);

            if (baseClass instanceof Runtime.BaseClass) {
                let argsType = this.resolveListExpressionType(whoIsTrying, node.getArgs(), scopeResolver, scope);

                if (argsType == null) {
                    return null;
                }

                let classConstructor = baseClass.getConstructor(argsType);

                if (classConstructor == null) {
                    this.addParserErrorNode(
                        "Não existe um construtor " + Runtime.generateMethodSignature(baseClass.getTypeName(), argsType),
                        node
                    );
                    return null;
                }

                // Verifica modificador de acesso
                if (classConstructor.getAccessModifier() == util.AccessModifier.Private
                    && classConstructor.getOwnerClass() != whoIsTrying.baseClass) {
                    this.addParserErrorNode("Construtor " + classConstructor.getMethodSignature()
                        + " é privado", node);
                    return null;
                }
            }

            return baseClass;
        } else if (node instanceof Ast.MethodOrVariable) {
            if (scopeResolver == null) {
                scopeResolver = new Runtime.ScopeResolver();
            } else {
                scopeResolver = scopeResolver.cloneScopeResolver();
            }

            if (scopeResolver.depth == 0 && scopeResolver.originalScope == null) {
                scopeResolver.originalScope = scope;
            }

            if (node.thisOrSuper != null) {
                if (scope.staticContext) {
                    this.addParserErrorNode(
                        "A variável " + node.thisOrSuper + " não pode ser acessada em um contexto estático "
                        , node);
                    return null;
                }

                // Verifica se foi utilizado o this já que somente super é inválidado pelo parser
                if (node.getMethodOrVariable() == null) {
                    return scope.ownerClass;
                }

                if (node.thisOrSuper == 'this') {
                    scope = scope.ownerClass.tempObjectScope;
                } else if (node.thisOrSuper == 'super') {
                    scope = scope.ownerClass.getExtendedClass().tempObjectScope;
                } else {
                    console.error('Modificador não reconhecido!!');
                }
            }

            return this.resolveMethodOrPropriety(whoIsTrying, node.getMethodOrVariable(), scopeResolver, scope);
        } else if (node instanceof Ast.BinaryExpr) {
            let isVariable = false;
            let nodeLeft = node.getLeft();
            if (nodeLeft instanceof Ast.MethodOrVariable) {
                let methodOrVar = nodeLeft.getMethodOrVariable();
                while (methodOrVar.getMethodOrVariable() != null) {
                    methodOrVar = methodOrVar.getMethodOrVariable()
                }
                if (methodOrVar instanceof Ast.Variable) {
                    isVariable = true;
                }
            }

            let leftType = this.resolveExpressionType(whoIsTrying, node.getLeft(), scopeResolver, scope);
            let rightType = this.resolveExpressionType(whoIsTrying, node.getRight(), scopeResolver, scope);
            let type = this.program.expressionResolver.resolveBinaryExprType(node.operator, leftType, rightType, isVariable);

            if (leftType != null && rightType != null && type == null) {
                this.addParserErrorNode(
                    "Tipos (" + leftType.getTypeName() + ", " + rightType.getTypeName() + ") e " + (isVariable ? 'variável' : 'não variável') + " inválidos para o operador " + node.operator
                    , node);
                return null;
            }

            return type;
        } else if (node instanceof Ast.UnaryExpr) {
            let isVariable = false;
            let nodeElem = node.getElem();
            if (nodeElem instanceof Ast.MethodOrVariable) {
                let methodOrVar = nodeElem.getMethodOrVariable();
                while (methodOrVar.getMethodOrVariable() != null) {
                    methodOrVar = methodOrVar.getMethodOrVariable()
                }
                if (methodOrVar instanceof Ast.Variable) {
                    isVariable = true;
                }
            }

            let elemType = this.resolveExpressionType(whoIsTrying, node.getElem(), scopeResolver, scope);
            let type = this.program.expressionResolver.resolveUnaryExprType(node.operator, elemType, isVariable);

            if (elemType != null && type == null) {
                this.addParserErrorNode(
                    "Tipo (" + elemType.getTypeName() + ") e " + (isVariable ? 'variável' : 'não variável') + " inválido para o operador " + node.operator
                    , node);
                return null;
            }

            return type;
        }
        console.error('Não foi possível determinar o tipo desta expressão ', node);
    }

    resolveMethodOrPropriety(whoIsTrying: WhoIsTrying, methodOrVariable: Ast.MethodOrVariableAccessor, scopeResolver: Runtime.ScopeResolver, scope: Runtime.BaseScope): Runtime.Type {
        scopeResolver.depth++;

        let type: Runtime.Type;

        if (methodOrVariable instanceof Ast.Variable) {
            let variable: Runtime.Variable;

            variable = scope.resolveVariableSafe(methodOrVariable.name);

            // Se não achou o identificador, verificar se não é o nome de uma classe
            if (variable == null) {
                if (scopeResolver.depth == 1) {
                    let baseClass = this.program.resolveClass(methodOrVariable.name);
                    if (baseClass != null) {
                        // Seta tipo do método ou variável
                        methodOrVariable.parserType = baseClass;
                        // Bom, achou a classe, agora procurar nela...
                        return this.resolveMethodOrPropriety(whoIsTrying, methodOrVariable.getMethodOrVariable(), scopeResolver, baseClass);
                    }
                }

                this.addParserErrorNode(
                    "Variável " + methodOrVariable.name + " não está definida",
                    methodOrVariable
                );
                return null;
            }

            // Verifica referencias para variáveis não estáticas em contexto estático
            if (scope.staticContext && variable.isStatic == false) {
                this.addParserErrorNode(
                    'Tentando referenciar a variável ' + variable.name + ' que não é estática',
                    methodOrVariable
                );
                return null;
            }

            // Verifica modificador de acesso
            if (variable.accessModifier == util.AccessModifier.Private
                && variable.ownerContext.ownerClass != whoIsTrying.baseClass) {
                this.addParserErrorNode(
                    'A propriedade ' + variable.name + ' é privada na classe ' + variable.ownerContext.ownerClass.getTypeName(),
                    methodOrVariable
                );
                return null;
            }

            // Se foi uma variável que pediu a resolução, ela deve ter sido declarada anteriormente
            if (scopeResolver.depth == 1) {
                if (typeof whoIsTrying.variable != 'undefined' && whoIsTrying.variable != null) {
                    if (whoIsTrying.variable.order <= variable.order) {
                        this.addParserErrorNode(
                            "A variável " + methodOrVariable.name + " não pode ser usada aqui pois foi"
                            + " declarada posteriormente",
                            methodOrVariable
                        );
                        return null;
                    }
                }
            }

            // Aqui foi resolvido
            type = variable.type;
        } else if (methodOrVariable instanceof Ast.MethodCall) {
            // Primeiro deve ser verificado qual a assinatura do método que será chamado.
            // Para saber os tipos dos métodos, o escopo original deve ser levado em conta
            let args = this.resolveListExpressionType(whoIsTrying, methodOrVariable.getArgs(), scopeResolver, scopeResolver.originalScope);

            // Se não conseguiu descobrir algum dos elementos da lista, nem adianta tentar achar o método
            if (args == null) {
                return null;
            }

            let method = scope.getMethodSafe(methodOrVariable.name, args);

            if (method == null) {
                this.addParserErrorNode(
                    "Nenhum método encontrado com a assinatura "
                    + Runtime.generateMethodSignature(methodOrVariable.name, args),
                    methodOrVariable
                );
                return null;
            }

            if (scope.staticContext == true && method.isStatic() == false) {
                this.addParserErrorNode(
                    "O método " + method.getMethodSignature() + " não é estático",
                    methodOrVariable
                );
                return null;
            }

            // Verifica modificador de acesso
            if (method.getAccessModifier() == util.AccessModifier.Private
                && method.getOwnerClass() != whoIsTrying.baseClass) {
                this.addParserErrorNode(
                    'O método ' + method.getMethodName() + ' é privada na classe ' + method.getOwnerClass().getTypeName(),
                    methodOrVariable
                );
                return null;
            }

            // Aqui foi resolvido
            type = method.getReturnType();
        }

        if (methodOrVariable == null) {
            return null;
        }

        // Seta tipo do método ou variável
        methodOrVariable.parserType = type;

        // Não tem mais nenhuma expressão? O tipo é esse...
        if (methodOrVariable.getMethodOrVariable() == null) {
            return type;
        }

        // Quer dizer que tem outra expressão após esta
        if (type instanceof Runtime.BaseClass) {
            scope = type.tempObjectScope;
            return this.resolveMethodOrPropriety(whoIsTrying, methodOrVariable.getMethodOrVariable(), scopeResolver, scope);
        }

        // Se chegou até aqui é um tipo primitivo
        this.addParserErrorNode(
            "O tipo " + type.getTypeName() + " não é uma classe e não possúi propriedades ou métodos",
            methodOrVariable
        );
        return null;
    }

    resolveListExpressionType(whoIsTrying: WhoIsTrying, listExpr: Array<Ast.ExprNode>, scopeResolver: Runtime.ScopeResolver, scope: Runtime.BaseScope): Array<Runtime.Type> {
        let arr: Array<Runtime.Type> = [];
        for (let i = 0; i < listExpr.length; i++) {
            let resolvedType = this.resolveExpressionType(whoIsTrying, listExpr[i], scopeResolver, scope);
            if (resolvedType == null) {
                return null;
            }
            arr.push(resolvedType);
        }
        return arr;
    }

    generateAst(fileName: string, code: string): Ast.ClassDeclaration {
        let inputStream = new InputStream(code);

        let lexer = new BasicJavaLexer(inputStream);
        let tokens = new CommonTokenStream(lexer);

        let parser = new BaseBasicJavaParser(tokens);
        parser.buildParseTrees = true;
        parser.removeErrorListeners();

        parser.addErrorListener(new Listener.AntlrParserListener(this, fileName));
        let tree = parser.compilationUnit();

        let visitor = new TreeConstructorVisitor(fileName);
        let classDeclaration: Ast.ClassDeclaration = visitor.visit(tree);

        classDeclaration.fileName = fileName;

        return classDeclaration;
    }

    /**
     * Setar a classe pai da classe.
     * @param {Runtime.UserClass} userClass
     */
    setSuperClass(baseClass: Runtime.BaseClass): void {
        if (baseClass instanceof Runtime.UserClass) {
            let superClassName = baseClass.getClassDeclaration().extend;
            if (superClassName != null) {
                let superClass = this.resolveTypeSafe(superClassName, baseClass.getClassDeclaration());

                if (superClass instanceof Runtime.BaseClass) {
                    baseClass.setExtendedClass(superClass);
                }
            } else {
                baseClass.setExtendedClass(this.program.resolveClass('Object'));
            }
        } else {
            if (baseClass.getExtendedClass() == null && baseClass.getTypeName() != 'Object') {
                baseClass.setExtendedClass(this.program.resolveClass('Object'));
            }
        }
    }

    /**
     * Cria métodos na classe passada.
     * @param {Runtime.Program}   program
     * @param {Runtime.UserClass} userClass
     */
    defineMethods(userClass: Runtime.UserClass): void {
        let classDeclaration = userClass.getClassDeclaration();
        for (let j = 0; j < classDeclaration.getMembers().length; j++) {
            let method = classDeclaration.getMembers()[j];

            if (method instanceof Ast.MethodDeclaration) {
                this.defineMethod(userClass, method);
            }
        }
    }

    defineMethod(userClass: Runtime.UserClass, methodDeclaration: Ast.MethodDeclaration) {
        // Verifica argumentos
        let methodArguments: Array<Runtime.ArgumentDeclaration> = [];
        let methodArgs = methodDeclaration.getArguments();
        for (let x = 0; x < methodArgs.length; x++) {
            let argumentAst = methodArgs[x];
            let argument = new Runtime.ArgumentDeclaration();

            argument.name = argumentAst.name;
            argument.type = this.resolveTypeSafe(argumentAst.type, argumentAst);

            if (argument.type != null) {
                methodArguments.push(argument);
            }
        }

        // Verifica tipo de retorno
        let returnType = this.resolveType(methodDeclaration.type);

        let userMethod = new Runtime.UserMethod(methodDeclaration, methodArguments, returnType);
        let isConstructor = (methodDeclaration.name == userClass.getTypeName()
            && typeof returnType == 'undefined');

        try {
            if (isConstructor) {
                userClass.addConstructor(userMethod);
            } else {
                userClass.addMethod(userMethod);
            }
        } catch (ex) {
            if (ex instanceof CompileParserException) {
                this.addParserErrorNode(
                    ex.message,
                    methodDeclaration
                );
                return;
            }
        }

        if (typeof returnType == 'undefined' && isConstructor == false) {
            this.addParserError(
                "O tipo de retorno " + (typeof methodDeclaration.type != 'undefined' ? methodDeclaration.type + ' ' : '') +
                "do método " + methodDeclaration.name + " não foi definido",
                userClass.getClassDeclaration().fileName,
                methodDeclaration.sourceRange
            );
        }
    }

    /**
     * Define as variáveis da classe e objeto.
     * @param {Runtime.UserClass} userClass
     */
    defineVariables(userClass: Runtime.UserClass): void {
        let classDeclaration = userClass.getClassDeclaration();
        for (let j = 0; j < classDeclaration.getMembers().length; j++) {
            let method = classDeclaration.getMembers()[j];

            if (method instanceof Ast.VariableDeclaration) {
                this.defineVariable(userClass, method);
            }
        }

        userClass.tempObjectScope = new Runtime.ObjectValue(userClass);
    }

    defineVariable(userClass: Runtime.UserClass, variableDeclaration: Ast.VariableDeclaration): void {
        let type: Runtime.Type;

        type = this.resolveTypeSafe(variableDeclaration.type, variableDeclaration);
        if (type == null) return;

        let variable = new Runtime.Variable(variableDeclaration.name, type);
        variable.isStatic = variableDeclaration.isStatic;
        variable.initializerNode = variableDeclaration.getInitializer();
        variable.accessModifier = variableDeclaration.accessModifier;
        variable.variableDeclaration = variableDeclaration;

        try {
            userClass.defineVariable(variable);
        } catch (ex) {
            this.addParserError(
                ex.message,
                userClass.getClassDeclaration().fileName,
                variableDeclaration.sourceRange
            );
            return;
        }
    }

    private defineNativeTypes(): void {
        let primitives = Native.createPrimitiveTypes();
        for (let i = 0; i < primitives.length; i++) {
            this.program.defineType(primitives[i]);
        }

        let objTypes = [
            new Native.NativeObject(this.program),
            new Native.String(this.program),
        ];

        for (let i = 0; i < objTypes.length; i++) {
            this.program.defineType(objTypes[i]);
        }

        for (let i = 0; i < objTypes.length; i++) {
            objTypes[i].declareMembers();
        }
    }

}
