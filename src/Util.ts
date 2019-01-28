
export interface ISourceRange {
    startColumn: number;
    startLine: number;
    endColumn: number;
    endLine: number;
}

export interface Iterator<T> {
    hasNext(): boolean;
    next(): T;
}

export interface IExceptionSourceRange {
    getSourceRange(): ISourceRange;
}

export class Exception extends Error {
    message: string;
    constructor(message?: string) {
        super(message);

        this.message = message;
    }
}

export class NotImplementedException extends Exception {
}

export class InvalidParameterException extends Exception {
}

export enum AccessModifier {
    Public = 0,
    Protected = 1,
    Private = 2
}

export namespace Operators {
    export function isArithmeticOperator(op: string): boolean {
        switch (op) {
            case '+':
            case '-':
            case '*':
            case '/':
            case '%':
                return true;
        }

        return false;
    }

    export function isEqualityOrRelationalOperator(op: string): boolean {
        switch (op) {
            case '==':
            case '!=':
            case '>':
            case '>=':
            case '<':
            case '<=':
                return true;
        }

        return false;
    }

    export function isConditionalOperator(op: string): boolean {
        switch (op) {
            case '&&':
            case '||':
                return true;
        }

        return false;
    }

    export function isAssignmentOperator(op: string): boolean {
        switch (op) {
            case '=':
            case '+=':
            case '-=':
            case '/=':
            case '*=':
                return true;
        }

        return false;
    }

    export function isOperator(op: string): boolean {
        return isArithmeticOperator(op)
            || isEqualityOrRelationalOperator(op)
            || isConditionalOperator(op)
            || isAssignmentOperator(op);
    }
}

export function stringToAccessModifier(param: string): AccessModifier {
    switch (param) {
        case "public":
            return AccessModifier.Public;
        case "protected":
            return AccessModifier.Protected;
        case "private":
            return AccessModifier.Private;
    }

    throw new InvalidParameterException();
}

export function accessModifierToString(param: AccessModifier): string {
    switch (param) {
        case AccessModifier.Public:
            return "public";
        case AccessModifier.Protected:
            return "protected";
        case AccessModifier.Private:
            return "private";
    }

    throw new InvalidParameterException();
}
