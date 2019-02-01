
import * as util from "./Util";
import * as Ast from "./Ast";
import * as Runtime from "./Runtime";
import * as Parser from "./Parser";
import { ErrorListener } from "antlr4/error";

/**
 * Base listener to walk in an Ast tree.
 */
export abstract class BaseListener {
    userClass: Runtime.UserClass;
    statementIdx: number = 0;
    isLastStatement: boolean = false;

    constructor(userClass: Runtime.UserClass) {
        this.userClass = userClass;
    }

    walk(): void {
        let methods = this.userClass.getMethods();

        for (let i = 0; i < methods.length; i++) {
            let method = methods[i];
            if (method instanceof Runtime.UserMethod) {
                this._visitMethod(method);
            }
        }

        let constructors = this.userClass.getConstructors();

        for (let i = 0; i < constructors.length; i++) {
            let constructor = constructors[i];
            if (constructor instanceof Runtime.UserMethod) {
                this._visitMethod(constructor);
            }
        }
    }

    enterMethod(node: Runtime.UserMethod): void {}
    exitMethod(node: Runtime.UserMethod): void {}

    _visitMethod(userMethod: Runtime.UserMethod): void {
        this.enterMethod(userMethod);
        this.statementIdx = 0;
        this.isLastStatement = false;

        let args = userMethod.getArguments();
        let methodDeclaration = userMethod.getMethodDeclaration();

        // Arguments from method
        for (let i = 0; i < args.length; i++) {
            this.enterArgumentDeclaration(args[i]);
            // This is an leaf node, so there is no need to visit an argument
            this.exitArgumentDeclaration(args[i]);
        }

        // BlockStatement
        this._visitBlockStatement(userMethod.getMethodDeclaration().getBlockStatement(), true);

        this.exitMethod(userMethod);
    }

    _visitBlockStatement(blockStatement: Ast.BlockStatement, setLast: boolean = false): void {
        this.enterBlockStatement(blockStatement);

        // Blockstatement can be null in case parser fails
        if (blockStatement == null) {
            return;
        }

        // Statements
        let blockStatementStatements = blockStatement.getStatements();
        for (let i = 0; i < blockStatementStatements.length; i++) {
            let statement = blockStatementStatements[i];
            if (setLast && (i == blockStatementStatements.length - 1)) {
                this.isLastStatement = true;
                this.lastStatement(statement);
            }
            this._visitStatement(statement);
        }

        if (blockStatementStatements.length == 0) {
            this.hasNoStatement();
        }

        this.exitBlockStatement(blockStatement);
    }

    _visitStatement(statement: Ast.Statement) {
        this.statementIdx++;

        if (statement instanceof Ast.VariableDeclaration) {
            this.enterVariableDeclaration(statement);
            this.exitVariableDeclaration(statement);
        } else if (statement instanceof Ast.BlockStatement) {
            this.enterBlockStatement(statement);
            this._visitBlockStatement(statement);
            this.exitBlockStatement(statement);
        } else if (statement instanceof Ast.IfStatement) {
            this.enterIfStatement(statement);
            this._visitIfStatement(statement);
            this.exitIfStatement(statement);
        } else if (statement instanceof Ast.ReturnStatement) {
            this.enterReturnStatement(statement);
            this.exitReturnStatement(statement);
        } else if (statement instanceof Ast.SuperCall) {
            this.enterSuperCall(statement);
            this.exitSuperCall(statement);
        } else if (statement instanceof Ast.Sysout) {
            this.enterSysout(statement);
            this.exitSysout(statement);
        } else if (statement instanceof Ast.ExprNode) {
            this.enterStatementExprNode(statement);
            this.exitStatementExprNode(statement);
        } else if (statement instanceof Ast.ForStatement) {
            this.enterForStatement(statement);
            this._visitForStatement(statement);
            this.exitForStatement(statement);
        } else if (statement instanceof Ast.WhileStatement) {
            this.enterWhileStatement(statement);
            this._visitWhileStatement(statement);
            this.exitWhileStatement(statement);
        }
    }

    _visitIfStatement(statement: Ast.IfStatement) {
        this._visitStatement(statement.getStatementsIf());
        if (statement.getStatementsElse() != null) {
            this._visitStatement(statement.getStatementsElse());
        }
    }

    _visitForStatement(statement: Ast.ForStatement) {
        this._visitStatement(statement.getStatement());
    }

    _visitWhileStatement(statement: Ast.WhileStatement) {
        this._visitStatement(statement.getStatement());
    }

    lastStatement(node: Ast.Statement): void {}
    hasNoStatement(): void {}

    enterArgumentDeclaration(node: Runtime.ArgumentDeclaration): void {}
    exitArgumentDeclaration(node: Runtime.ArgumentDeclaration): void {}

    enterVariableDeclaration(node: Ast.VariableDeclaration): void {}
    exitVariableDeclaration(node: Ast.VariableDeclaration): void {}

    enterForStatement(node: Ast.ForStatement): void {}
    exitForStatement(node: Ast.ForStatement): void {}

    enterWhileStatement(node: Ast.WhileStatement): void {}
    exitWhileStatement(node: Ast.WhileStatement): void {}

    enterStatementExprNode(node: Ast.ExprNode): void {}
    exitStatementExprNode(node: Ast.ExprNode): void {}

    enterIfStatement(node: Ast.IfStatement): void {}
    exitIfStatement(node: Ast.IfStatement): void {}

    enterReturnStatement(node: Ast.ReturnStatement): void {}
    exitReturnStatement(node: Ast.ReturnStatement): void {}

    enterBlockStatement(node: Ast.BlockStatement): void {}
    exitBlockStatement(node: Ast.BlockStatement): void {}

    enterSuperCall(node: Ast.SuperCall): void {}
    exitSuperCall(node: Ast.SuperCall): void {}

    enterSysout(node: Ast.Sysout): void {}
    exitSysout(node: Ast.Sysout): void {}

}

/**
 * Catches errors from antlr parser and register them in to the BasicJavaParser.
 */
export class AntlrParserListener extends ErrorListener {
    parser: Parser.BasicJavaParser;
    fileName: string;

    constructor(parser: Parser.BasicJavaParser, fileName: string) {
        super();
        this.parser = parser;
        this.fileName = fileName;
    }

    syntaxError(recognizer: any, offendingSymbol: any, line: any, column: any, msg: any, e: any): void {
        this.parser.addParserError('Sintax error: "' + offendingSymbol.text + '" is unexpected', this.fileName, {
            startColumn: column,
            startLine: line,
            endColumn: 0,
            endLine: 0
        });
    }
}
