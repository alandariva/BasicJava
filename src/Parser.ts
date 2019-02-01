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
        let message = this.message + " in file " + this.file
        if (this.sourceRange != null) {
            message += " line " + this.sourceRange.startLine
                + " column " + this.sourceRange.startColumn;
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

        if (node instanceof Ast.BinaryExpr) {
            if (!util.Operators.isAssignmentOperator(node.operator)) {
                this.parser.addParserErrorNode(node.operator + " operator is not allowed here", node);
            }
        } else if (node instanceof Ast.MethodOrVariable) {
            let methodOrVar = node.getMethodOrVariable();
            if (methodOrVar == null) {
                this.parser.addParserErrorNode(
                    "It must be a method call",
                    node
                );
                return;
            }
            while (methodOrVar.getMethodOrVariable() != null) {
                methodOrVar = methodOrVar.getMethodOrVariable()
            }

            if (methodOrVar instanceof Ast.MethodCall == false) {
                this.parser.addParserErrorNode(
                    "It must be a method call",
                    node
                );
            }
        } else if (node instanceof Ast.UnaryExpr) {
            if (node.operator != '++' && node.operator != '--') {
                this.parser.addParserErrorNode(
                    "This is not a command",
                    node
                );
            }
        } else {
            this.parser.addParserErrorNode(
                "This is not a command",
                node
            );
        }
    }

    enterIfStatement(node: Ast.IfStatement): void {
        let type = this.resolveExpressionType(node.getCondition());
        if (type != null && type.getTypeName() != 'boolean') {
            this.parser.addParserErrorNode(
                "Incompatible types. Require boolean, found " + type.getTypeName(),
                node.getCondition()
            );
        }
    }

    enterReturnStatement(node: Ast.ReturnStatement): void {
        if (this.currentMethod.isConstructor) {
            if (node.getExpression() != null) {
                this.parser.addParserErrorNode(
                    "Constructors cannot return any value",
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
                    "Return type is not compatible with " + this.currentMethod.getReturnType().getTypeName(),
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
                    "Incompatible types. Require boolean, found " + type.getTypeName(),
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
                    "Incompatible types. Require boolean, found " + type.getTypeName(),
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
                "It is not possible to call super in a non constructor method",
                node.fileName,
                node.sourceRange
            );
        } else {
            if (this.statementIdx != 1) {
                this.parser.addParserError(
                    "Call to super must be the first statement",
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
                "The last statement of this method must be a return",
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
                    "The last statement of this method must be a return",
                    this.currentMethod.getMethodDeclaration()
                );
            }
        }
    }

    verifyTypeCompability(variable: Runtime.Variable, type: Runtime.Type, node: Ast.BaseNode): void {
        if (type != null && type.isCompatible(variable.type) == false) {
            this.parser.addParserError(
                "Type " + type.getTypeName() + " is not compatible with " + variable.type.getTypeName(),
                node.fileName,
                node.sourceRange
            );
        }
    }

    defineVariable(range: util.ISourceRange, variable: Runtime.Variable, scope: Runtime.BaseScope = this.currentScope): void {
        try {
            // Before declaring variable, verifies if it is not already created in the scope
            let declaredVariable = this.currentScope.resolveVariableSafe(variable.name, this.methodScope);
            if (declaredVariable == null) {
                scope.defineVariable(variable);
            } else {
                this.parser.addParserError(
                    'The variable ' + variable.name + ' is already defined in method',
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
 * Class responsible for building the AST.
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

        // Creates methods and properties of the class
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

        // Verifies if it is a static method
        if (ctx.ClassMemberModifier() != null) {
            node.isStatic = true;
        }

        // Handle return type
        if (ctx.methodDeclaration().type() != null) {
            node.type = this.resolveType(ctx.methodDeclaration().type());
        } else if (ctx.methodDeclaration().voidT() != null) {
            node.type = 'void';
        }

        // Handle method access modifier
        if (ctx.ClassMemberAccessModifier() != null) {
            node.accessModifier = util.stringToAccessModifier(ctx.ClassMemberAccessModifier().getText());
        } else {
            node.accessModifier = util.AccessModifier.Public;
        }

        // Handle parameters
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
            console.error('AST: statement not found', ctx);
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

        if (ctx.arguments() != null) { // Checks if it is a method call
            let node = new Ast.MethodCall(ctx, this.fileName);
            node.name = ctx.Identifier().getText();
            node.setArgs(this.visitArguments(ctx.arguments()));

            // Checks if it calls other methods or variables
            if (ctx.methodOrVariableSuffix() != null) {
                let methodOrVar = this.visitMethodOrVariableSuffix(ctx.methodOrVariableSuffix());
                if (methodOrVar != null) {
                    node.setMethodOrVariable(methodOrVar);
                }
            }
            return node;
        }

        // It is a variable
        let node = new Ast.Variable(ctx, this.fileName);
        node.name = ctx.Identifier().getText();

        // Checks if it calls other methods or variables
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
                throw new util.NotImplementedException("Primitive type not implemented");
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

        console.error(ctx, "Expression not implemented");
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
 * Makes parse of files and semantic analysis.
 */
export class BasicJavaParser {
    private program: Runtime.Program;
    private errors: Array<ParserError> = [];

    parse(codes: { [id: string]: string }): Runtime.Program {
        let classesDeclaration: Array<Ast.ClassDeclaration> = []; // Array with all classes

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

        // Identify all classes
        for (let i = 0; i < classesDeclaration.length; i++) {
            let userClass = new Runtime.UserClass(this.program, classesDeclaration[i]);
            if (this.program.defineType(userClass) == false) {
                this.addParserErrorNode("O tipo " + userClass.getTypeName() + " já foi definido",
                    userClass.getClassDeclaration());
            } else {
                classes.push(userClass);
            }
        }

        // Set superclass and define methods
        for (let i = 0; i < classes.length; i++) {
            if (classes[i] instanceof Runtime.UserClass) {
                let userClass = classes[i] as Runtime.UserClass;

                userClass.getClassDeclaration().parseScope = userClass;

                // Set superclass since not all classes were known in the first process
                this.setSuperClass(userClass);

                // Define methods from classes.
                // It is important not to identify variables yet because they need to be
                // created in super -> child order (correct execution order)
                this.defineMethods(userClass);
            } else {
                this.setSuperClass(classes[i]);
            }
        }

        // Verifies cyclic inheritance
        for (let i = 0; i < classes.length; i++) {
            let baseClass = classes[i];

            if (baseClass instanceof Runtime.UserClass) {
                let baseClassTemp: Runtime.BaseClass = baseClass;
                while (baseClassTemp != null) {
                    baseClassTemp = baseClassTemp.getExtendedClass();
                    // If it ended up in the same class it started, we've got a cyclic inheritance
                    if (baseClassTemp != null && baseClassTemp.getTypeName() == baseClass.getTypeName()) {
                        this.addParserErrorNode("Cyclic inheritance", baseClass.getClassDeclaration());
                        baseClass.setExtendedClass(null);
                        break;
                    }
                }
            }
        }

        this.program.updateClassesDiscovered();

        // Verifies methods override and define variables of class/object
        {
            let it = new Runtime.ClassRootIterator(classes);

            while (it.hasNext()) {
                let classProcessing = it.next();

                let isRootClass = classProcessing.getExtendedClass() == null;

                // Jct classes don't need to be checked
                if (classProcessing instanceof Runtime.UserClass) {
                    this.verifyOverriddenMethods(classProcessing, isRootClass);
                    this.defineVariables(classProcessing);
                } else {
                    classProcessing.tempObjectScope = new Runtime.ObjectValue(classProcessing);
                }
            }
        }

        // Verifies if constructors are valid
        {
            let it = new Runtime.ClassRootIterator(classes);

            while (it.hasNext()) {
                let classProcessing = it.next();

                if (classProcessing instanceof Runtime.UserClass) {
                    this.verifyConstructors(classProcessing);
                }
            }
        }

        // Verifies if class variables are declared correctly
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
                "The type " + typeName + " is not defined",
                node
            );
            type = null;
        }

        return type;
    }

    private verifyVariables(classProcessing: Runtime.UserClass): void {
        // Testing object/class attributes
        let variables = classProcessing.getVariables();

        for (let nomeVar in variables) {
            let variable = variables[nomeVar];

            // Just need to check if there is an assignment
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
                            "Type " + type.getTypeName() +
                            " is not compatible with " + variable.type.getTypeName(),
                            variable.variableDeclaration != null ? variable.variableDeclaration : classProcessing.getClassDeclaration()
                        );
                    }
                }
            }
        }
    }

    /**
     * Verifies if the override methods are valid.
     */
    private verifyOverriddenMethods(classProcessing: Runtime.UserClass, isRootClass: boolean): void {
        // Root classes doen't have what to override
        if (isRootClass) {
            return;
        }

        let methods = classProcessing.getMethods();

        for (let i = 0; i < methods.length; i++) {
            let baseMethodExtended: Runtime.BaseMethod = null;
            let classTemp: Runtime.BaseClass = classProcessing;

            // Searches recursively for the closest method with the same signature
            while (classTemp.getExtendedClass() != null) {
                baseMethodExtended = classTemp.getExtendedClass()
                    .getMethodBySignature(methods[i].getMethodSignature());
                if (baseMethodExtended != null) {
                    break;
                }
                classTemp = classTemp.getExtendedClass();
            }

            // If it found the override method
            if (baseMethodExtended instanceof Runtime.BaseMethod) {
                if (baseMethodExtended.getAccessModifier() < methods[i].getAccessModifier()) {
                    this.addParserErrorNode(
                        "Method " + methods[i].getMethodSignature() + " cannot have an access modifier more restrict"
                        + " of one defined in a superclass",
                        classProcessing.getClassDeclaration()
                    );
                }

                // Verifies static attribute
                if (baseMethodExtended.isStatic() != methods[i].isStatic()) {
                    this.addParserErrorNode(
                        "Method " + methods[i].getMethodSignature() + " cannot override"
                        + " a " + ((baseMethodExtended.isStatic() ? 'static' : 'non static') + "method"),
                        classProcessing.getClassDeclaration()
                    );
                }
            }

        }
    }

    private verifyMethods(classProcessing: Runtime.UserClass): void {
        let methods = classProcessing.getMethods();

        let listener = new VerifyMethodsListener(this, classProcessing);
        listener.walk();
    }

    private verifyConstructors(classProcessing: Runtime.UserClass): void {
        let constructors = classProcessing.getConstructors();

        // Use a default constructor when there is no constructor defined
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

        // Verifies if constructors call a valid super()
        if (classProcessing.getExtendedClass() != null) {
            for (let j = 0; j < constructors.length; j++) {
                let constructor = constructors[j];

                // It is only necessary to verify methods defined by user
                if (constructor instanceof Runtime.UserMethod) {
                    let statement = constructor.getMethodDeclaration().getBlockStatement().getStatements()[0];

                    // In case the first statement is not a super() call, create a supercall node
                    if ((statement instanceof Ast.SuperCall) == false) {
                        // There is no problem if the superclass has a default constructor
                        if (classProcessing.getExtendedClass().hasConstructor([])) {
                            constructor.getMethodDeclaration().getBlockStatement().addStatementTop(
                                new Ast.SuperCall(constructor.getMethodDeclaration().ctx, constructor.getMethodDeclaration().fileName)
                            );
                        } else {
                            // If there is not a default constructor, user must to inform valid parameters
                            this.addParserError(
                                "The constructor of superclass must be called explicitly because there is no default constructor",
                                classProcessing.getTypeName(),
                                constructor.getMethodDeclaration().sourceRange
                            );
                            continue; // Go to next constructor
                        }
                    }

                    // Now this statement is a Ast.SuperCall and it will be validated
                    statement = constructor.getMethodDeclaration().getBlockStatement().getStatements()[0];
                    if (statement instanceof Ast.SuperCall) { // Typescript check
                        let localScope = new Runtime.LocalScope(classProcessing, classProcessing, false);

                        // Define arguments
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
                                    "There is no constructor "
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
                                    "Constructor " + calledConstructor.getMethodSignature() + " is private",
                                    statement
                                );
                                continue;
                            }
                        }
                    }
                }
            }
        } else {
            // If it is a root class, no need to call super()
            for (let j = 0; j < constructors.length; j++) {
                let constructor = constructors[j];

                if (constructor instanceof Runtime.UserMethod) {
                    if (constructor.getMethodDeclaration().getBlockStatement() == null) {
                        return;
                    }
                    let statement = constructor.getMethodDeclaration().getBlockStatement().getStatements()[0];
                    if (typeof statement != 'undefined' && statement instanceof Ast.SuperCall) {
                        this.addParserError(
                            "There is no superclass to be invoked",
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
                        "There is no contructor " + Runtime.generateMethodSignature(baseClass.getTypeName(), argsType),
                        node
                    );
                    return null;
                }

                // Verifies access modifier
                if (classConstructor.getAccessModifier() == util.AccessModifier.Private
                    && classConstructor.getOwnerClass() != whoIsTrying.baseClass) {
                    this.addParserErrorNode("Constructor " + classConstructor.getMethodSignature()
                        + " is private", node);
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
                        "Variable " + node.thisOrSuper + " cannot be accessed in a static context"
                        , node);
                    return null;
                }

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
                    "Types (" + leftType.getTypeName() + ", " + rightType.getTypeName() + ") and " + (isVariable ? 'variable' : 'non-variable') + " invalid for the " + node.operator + " operator"
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
                    "Type (" + elemType.getTypeName() + ") and " + (isVariable ? 'variable' : 'non-variable') + " invalid for " + node.operator + " operator"
                    , node);
                return null;
            }

            return type;
        }
        console.error('It was not possible to determine the expression type', node);
    }

    resolveMethodOrPropriety(whoIsTrying: WhoIsTrying, methodOrVariable: Ast.MethodOrVariableAccessor, scopeResolver: Runtime.ScopeResolver, scope: Runtime.BaseScope): Runtime.Type {
        scopeResolver.depth++;

        let type: Runtime.Type;

        if (methodOrVariable instanceof Ast.Variable) {
            let variable: Runtime.Variable;

            variable = scope.resolveVariableSafe(methodOrVariable.name);

            // If it didn't find the identifier, verifies if it is a class name
            if (variable == null) {
                if (scopeResolver.depth == 1) {
                    let baseClass = this.program.resolveClass(methodOrVariable.name);
                    if (baseClass != null) {
                        // Now we know it is a baseClass type
                        methodOrVariable.parserType = baseClass;
                        // Find the runtime type
                        return this.resolveMethodOrPropriety(whoIsTrying, methodOrVariable.getMethodOrVariable(), scopeResolver, baseClass);
                    }
                }

                this.addParserErrorNode(
                    "Variable " + methodOrVariable.name + " is not defined",
                    methodOrVariable
                );
                return null;
            }

            // Verifies references for non static variables in static context
            if (scope.staticContext && variable.isStatic == false) {
                this.addParserErrorNode(
                    'Trying to reference variable ' + variable.name + ' that is not static',
                    methodOrVariable
                );
                return null;
            }

            // Verifies access modifier
            if (variable.accessModifier == util.AccessModifier.Private
                && variable.ownerContext.ownerClass != whoIsTrying.baseClass) {
                this.addParserErrorNode(
                    'The property ' + variable.name + ' is private in class ' + variable.ownerContext.ownerClass.getTypeName(),
                    methodOrVariable
                );
                return null;
            }

            // If it is a variable it must have been previously declared
            if (scopeResolver.depth == 1) {
                if (typeof whoIsTrying.variable != 'undefined' && whoIsTrying.variable != null) {
                    if (whoIsTrying.variable.order <= variable.order) {
                        this.addParserErrorNode(
                            "The variable " + methodOrVariable.name + " cannot be used in here"
                            + " because it was declared after",
                            methodOrVariable
                        );
                        return null;
                    }
                }
            }

            // Resolved
            type = variable.type;
        } else if (methodOrVariable instanceof Ast.MethodCall) {
            // First of all it must be verified what is the method signature.
            // To known the method types the original scope have to be considered.
            let args = this.resolveListExpressionType(whoIsTrying, methodOrVariable.getArgs(), scopeResolver, scopeResolver.originalScope);

            // Could not identify the type of one of the elements
            if (args == null) {
                return null;
            }

            let method = scope.getMethodSafe(methodOrVariable.name, args);

            if (method == null) {
                this.addParserErrorNode(
                    "No method found with this signature "
                    + Runtime.generateMethodSignature(methodOrVariable.name, args),
                    methodOrVariable
                );
                return null;
            }

            if (scope.staticContext == true && method.isStatic() == false) {
                this.addParserErrorNode(
                    "The method " + method.getMethodSignature() + " is not static",
                    methodOrVariable
                );
                return null;
            }

            // Verifies access modifier
            if (method.getAccessModifier() == util.AccessModifier.Private
                && method.getOwnerClass() != whoIsTrying.baseClass) {
                this.addParserErrorNode(
                    'The method ' + method.getMethodName() + ' is private in class ' + method.getOwnerClass().getTypeName(),
                    methodOrVariable
                );
                return null;
            }

            // Resolved
            type = method.getReturnType();
        }

        if (methodOrVariable == null) {
            return null;
        }

        // Set method/variable type
        methodOrVariable.parserType = type;

        // If there is no more calls the type is already resolved
        if (methodOrVariable.getMethodOrVariable() == null) {
            return type;
        }

        // There is another call after this one, resolve it
        if (type instanceof Runtime.BaseClass) {
            scope = type.tempObjectScope;
            return this.resolveMethodOrPropriety(whoIsTrying, methodOrVariable.getMethodOrVariable(), scopeResolver, scope);
        }

        // It is a primitive type
        this.addParserErrorNode(
            "The type " + type.getTypeName() + " is a primitive type and has no methods/variables",
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
     * Set superclass of classes.
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
     * Create methods of classes.
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
        // Verifies arguments
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

        // Verifies return type
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
                "The return type " + (typeof methodDeclaration.type != 'undefined' ? methodDeclaration.type + ' ' : '') +
                " of method " + methodDeclaration.name + " is not defined",
                userClass.getClassDeclaration().fileName,
                methodDeclaration.sourceRange
            );
        }
    }

    /**
     * Define the variables of class and object.
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
