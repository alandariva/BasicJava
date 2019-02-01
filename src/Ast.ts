
import * as util from "./Util";
import * as Runtime from "./Runtime";

export class BaseNode {
    sourceRange: util.ISourceRange = null;
    ctx: any;
    fileName: string;
    parent: BaseNode;
    children: Array<BaseNode> = [];

    constructor(ctx: any, fileName: string) {
        if (ctx == null && fileName == null) {
            return;
        }
        this.sourceRange = {
            startColumn: ctx.start.column,
            startLine: ctx.start.line,
            endColumn: ctx.stop.column + (ctx.stop.stop + 1 - ctx.stop.start),
            endLine: ctx.stop.line
        };
        this.ctx = ctx;
        this.fileName = fileName;
        ctx.baseNode = this;
    }

    addChild(node: BaseNode) {
        if (node == null) return;

        this.children.push(node);
        node.parent = this;
    }

    addChildren(nodes: Array<BaseNode>) {
        for (let i = 0; i < nodes.length; i++) {
            this.addChild(nodes[i]);
        }
    }
}

export class ArgumentDeclaration extends BaseNode {
    name: string;
    type: string;
}

export class Statement extends BaseNode {
}

export class BasicDebug extends Statement {
}

export class BlockStatement extends Statement {
    private statements: Array<Statement> = [];
    parseScope: Runtime.BaseScope;

    getStatements(): Array<Statement> {
        return this.statements;
    }

    addStatement(node: Statement) {
        this.statements.push(node);
        this.addChild(node);
    }

    addStatementTop(node: Statement) {
        this.statements.unshift(node);
        this.addChild(node);
    }

}

export class ExprNode extends Statement {
}

export class PrimitiveExprNode extends ExprNode {
    value: any;
    type: string;
    runtimeType: Runtime.Type;
}

export class ClassDeclaration extends BaseNode {
    fileName: string;
    name: string;
    extend: string = null;
    private members: Array<BaseNode> = [];
    parseScope: Runtime.BaseScope;

    getMembers(): Array<BaseNode> {
        return this.members;
    }

    addMember(node: BaseNode) {
        this.members.push(node);
        this.addChild(node);
    }
}

export class VariableDeclaration extends Statement {
    name: string;
    type: string;
    accessModifier: util.AccessModifier;
    private initializer: ExprNode = null;
    isStatic: boolean = false;

    getInitializer(): ExprNode {
        return this.initializer;
    }

    setInitializer(node: ExprNode): void {
        this.initializer = node;
        this.addChild(node);
    }
}

export class MethodOrVariableAccessor extends ExprNode {
    name: string;
    private methodOrVariable: MethodOrVariableAccessor = null;
    parserType: Runtime.Type;

    getMethodOrVariable(): MethodOrVariableAccessor {
        return this.methodOrVariable;
    }

    setMethodOrVariable(node: MethodOrVariableAccessor): void {
        this.methodOrVariable = node;
        this.addChild(node);
    }
}

export class MethodOrVariable extends ExprNode {
    thisOrSuper: string = null;
    private methodOrVariable: MethodOrVariableAccessor = null;

    getMethodOrVariable(): MethodOrVariableAccessor {
        return this.methodOrVariable;
    }

    setMethodOrVariable(node: MethodOrVariableAccessor): void {
        this.methodOrVariable = node;
        this.addChild(node);
    }
}

export class MethodCall extends MethodOrVariableAccessor {
    private args: Array<ExprNode> = [];

    getArgs(): Array<ExprNode> {
        return this.args;
    }

    addArg(node: BaseNode): void {
        this.args.push(node);
        this.addChild(node);
    }

    setArgs(_args: Array<ExprNode>): void {
        this.args = _args;
        this.addChildren(this.args);
    }
}

export class Variable extends MethodOrVariableAccessor {
}

export class MethodDeclaration extends BaseNode {
    name: string;
    type: string;
    isStatic: boolean = false;
    accessModifier: util.AccessModifier = util.AccessModifier.Public;
    private arguments: Array<ArgumentDeclaration> = [];
    private blockStatement: BlockStatement = null;

    getArguments(): Array<ArgumentDeclaration> {
        return this.arguments;
    }

    addArgument(node: ArgumentDeclaration): void {
        this.arguments.push(node);
        this.addChild(node);
    }

    setArguments(_args: Array<ArgumentDeclaration>): void {
        this.arguments = _args;
        this.addChildren(_args);
    }

    getBlockStatement(): BlockStatement {
        return this.blockStatement;
    }

    setBlockStatement(node: BlockStatement): void {
        this.blockStatement = node;
        this.addChild(node);
    }
}

export class Sysout extends Statement {
    private expression: ExprNode;
    newLine: boolean = true;

    getExpression(): ExprNode {
        return this.expression;
    }

    setExpression(node: ExprNode): void {
        this.expression = node;
        this.addChild(node);
    }
}

export class SuperCall extends BaseNode {
    private args: Array<ExprNode> = [];

    getArgs(): Array<ExprNode> {
        return this.args;
    }

    addArg(node: BaseNode): void {
        this.args.push(node);
        this.addChild(node);
    }

    setArgs(_args: Array<ExprNode>): void {
        this.args = _args;
        this.addChildren(this.args);
    }
}

export class NewExprNode extends ExprNode {
    className: string;
    private args: Array<ExprNode> = [];

    getArgs(): Array<ExprNode> {
        return this.args;
    }

    addArg(node: BaseNode): void {
        this.args.push(node);
        this.addChild(node);
    }

    setArgs(_args: Array<ExprNode>): void {
        this.args = _args;
        this.addChildren(this.args);
    }
}

export class BinaryExpr extends ExprNode {
    operator: string;
    private left: ExprNode;
    private right: ExprNode;

    getLeft(): ExprNode {
        return this.left;
    }

    setLeft(node: ExprNode): void {
        this.left = node;
        this.addChild(node);
    }

    getRight(): ExprNode {
        return this.right;
    }

    setRight(node: ExprNode): void {
        this.right = node;
        this.addChild(node);
    }
}

export class UnaryExpr extends ExprNode {
    operator: string;
    modOperator: string = null;
    private elem: ExprNode;

    getElem(): ExprNode {
        return this.elem;
    }

    setElem(node: ExprNode): void {
        this.elem = node;
        this.addChild(node);
    }
}

export class IfStatement extends Statement {
    private condition: ExprNode;
    private statementsIf: Statement = null;
    private statementsElse: Statement = null;

    getCondition(): ExprNode {
        return this.condition;
    }

    setCondition(node: ExprNode): void {
        this.condition = node;
        this.addChild(node);
    }

    getStatementsIf(): Statement {
        return this.statementsIf;
    }

    setStatementsIf(node: Statement): void {
        this.statementsIf = node;
        this.addChild(node);
    }

    getStatementsElse(): Statement {
        return this.statementsElse;
    }

    setStatementsElse(node: Statement): void {
        this.statementsElse = node;
        this.addChild(node);
    }
}

export class ForStatement extends Statement {
    private forInit: BaseNode = null;
    private expression: ExprNode = null;
    private expressionList: Array<ExprNode> = [];
    private statement: Statement;

    getForInit(): BaseNode {
        return this.forInit;
    }

    setForInit(node: ExprNode): void {
        this.forInit = node;
        this.addChild(node);
    }

    getExpression(): ExprNode {
        return this.expression;
    }

    setExpression(node: ExprNode): void {
        this.expression = node;
        this.addChild(node);
    }

    getStatement(): Statement {
        return this.statement;
    }

    setStatement(node: Statement): void {
        this.statement = node;
        this.addChild(node);
    }

    getExpressionList(): Array<ExprNode> {
        return this.expressionList;
    }

    addExpressionList(node: BaseNode): void {
        this.expressionList.push(node);
        this.addChild(node);
    }

    setExpressionList(_args: Array<ExprNode>): void {
        this.expressionList = _args;
        this.addChildren(this.expressionList);
    }
}

export class WhileStatement extends Statement {
    private expression: ExprNode;
    private statement: Statement;

    getExpression(): ExprNode {
        return this.expression;
    }

    setExpression(node: ExprNode): void {
        this.expression = node;
        this.addChild(node);
    }

    getStatement(): Statement {
        return this.statement;
    }

    setStatement(node: Statement): void {
        this.statement = node;
        this.addChild(node);
    }
}

export class ReturnStatement extends Statement {
    private expression: ExprNode = null;

    getExpression(): ExprNode {
        return this.expression;
    }

    setExpression(node: ExprNode): void {
        this.expression = node;
        this.addChild(node);
    }
}
