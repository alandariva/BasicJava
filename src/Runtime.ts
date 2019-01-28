
import * as util from "./Util";
import * as Ast from "./Ast";
import * as Parser from "./Parser";

import Interpreter = require("./Runtime_Interpreter");

export {Interpreter}

export class RuntimeException extends util.Exception {

}

export class ReturnException extends RuntimeException {
    value: Value;
    constructor(value: Value = null) {
        super();
        this.value = value;
    }
}

export interface ExecuteExprResult {
    value: Value;
    variable?: Variable;
    leftOriginalRawValue?: any;
}

export interface Type {
    getTypeName(): string;
    isCompatible(t: Type): boolean;
    getDefaultValue(): Value;
    isVariableType(): boolean;
}

export interface Value {
    getType(): Type;
}

export interface Scope {
    resolveType(type: string): Type;
}

export function generateMethodSignature(name: string, args: Array<Type>): string {
    let signature = name;

    if (args.length > 0) {
        let params = [];
        for (let i = 0; i < args.length; i++) {
            params.push(args[i].getTypeName());
        }
        signature += '(' + params.join(', ') + ')';
    } else {
        signature += '()';
    }

    return signature;
}

export class ExpressionResolver {
    program: Program;

    constructor(program: Program) {
        this.program = program;
    }

    /**
     * Verifica o tipo do resultado de uma expressõo binária.
     * @param  {string} op      Operação
     * @param  {Type}   lhsType Termo da esquerda da operação
     * @param  {Type}   rhsType Termo da direita da operação
     * @return {Type}
     */
    public resolveBinaryExprType(op: string, lhsType: Type, rhsType: Type, isVariable: boolean): Type {
        if (lhsType == null || rhsType == null) {
            return null;
        }

        let lhsTypeName = lhsType.getTypeName();
        let rhsTypeName = rhsType.getTypeName();

        if (op == '=') {
            if (((lhsTypeName == rhsTypeName) || (lhsType instanceof BaseClass && rhsTypeName == 'null') || (lhsTypeName == 'double' && rhsTypeName == 'int')) && isVariable) {
                return lhsType;
            } else if (lhsType instanceof BaseClass && rhsType instanceof BaseClass && isVariable) {
                if (rhsType.isCompatible(lhsType)) {
                    return lhsType;
                }
            }
        } else if (op == '+=' || op == '-=' || op == '/=' || op == '*=') {
            if ((lhsTypeName == 'int' || lhsTypeName == 'double') && (rhsTypeName == 'int' || rhsTypeName == 'double') && isVariable) {
                return lhsTypeName == 'double' ? lhsType : rhsType;
            } else if (lhsTypeName == 'String' && (op == '+=')) {
                return this.program.resolveType('String');
            }
        } else if ((lhsTypeName == 'int' && rhsTypeName == 'int') || (lhsTypeName == 'double' && rhsTypeName == 'double')) {
            if (util.Operators.isArithmeticOperator(op)) {
                return lhsType;
            } else if (util.Operators.isEqualityOrRelationalOperator(op)) {
                return this.program.resolveType('boolean');
            }
        } else if (lhsTypeName == 'int' && rhsTypeName == 'double') {
            if (util.Operators.isArithmeticOperator(op)) {
                return rhsType;
            } else if (util.Operators.isEqualityOrRelationalOperator(op)) {
                return this.program.resolveType('boolean');
            }
        } else if (lhsTypeName == 'double' && rhsTypeName == 'int') {
            if (util.Operators.isArithmeticOperator(op)) {
                return lhsType;
            } else if (util.Operators.isEqualityOrRelationalOperator(op)) {
                return this.program.resolveType('boolean');
            }
        } else if (lhsTypeName == 'boolean' && rhsTypeName == 'boolean') {
            if (util.Operators.isConditionalOperator(op)) {
                return lhsType;
            } else if (op == '==' || op == '!=') {
                return lhsType;
            }
        } else if ((lhsTypeName == 'String' || rhsTypeName == 'String') && (op == '+')) {
            // No caso de + e pelo menos uma string, qualquer tipo é válido
            return this.program.resolveType('String');
        } else if ((lhsTypeName == 'null' || lhsType instanceof BaseClass)
            && (rhsTypeName == 'null' || rhsType instanceof BaseClass)) {
            // O null ou uma instância só pode ser comparado com == e !=
            if (op == '==' || op == '!=') {
                return this.program.resolveType('boolean');
            }
        }

        return null;
    }

    public resolveUnaryExprType(op: string, elemType: Type, isVariable: boolean): Type {
        if (elemType == null) {
            return null;
        }

        let elemTypeName = elemType.getTypeName();

        if (op == '--' || op == '++') {
            if (isVariable && (elemTypeName == 'int' || elemTypeName == 'double')) {
                return elemType;
            }
        } else if (op == '!') {
            if (elemTypeName == 'boolean') {
                return elemType;
            }
        } else if (op == '-' || op == '+') {
            if (elemTypeName == 'int' || elemTypeName == 'double') {
                return elemType;
            }
        }

        return null;
    }

    public resolveUnaryExpr(unaryExpr: Ast.UnaryExpr, exprResul: ExecuteExprResult): ExecuteExprResult {

        if (unaryExpr.operator == '++' || unaryExpr.operator == '--') {
            if (exprResul.variable.value instanceof PrimitiveValue) {
                let oldValue = exprResul.variable.value.rawValue;
                if (unaryExpr.operator == '++') {
                    exprResul.variable.value.rawValue++;
                } else {
                    exprResul.variable.value.rawValue--;
                }

                if (unaryExpr.modOperator == 'd') {
                    let oldValueObj = new PrimitiveValue(exprResul.variable.value.type, oldValue);
                    return { value: oldValueObj, variable: exprResul.variable };
                } else {
                    return { value: exprResul.variable.value, variable: exprResul.variable };
                }
            } else {
                console.error('Expressão unária não encontrada');
                return null;
            }
        } else if (unaryExpr.operator == '!') {
            if (exprResul.value instanceof PrimitiveValue) {
                return { value: new PrimitiveValue(exprResul.value.type, !exprResul.value.rawValue), variable: exprResul.variable };
            } else {
                console.error('Expressão unária não encontrada');
                return null;
            }
        } else if (unaryExpr.operator == '-') {
            if (exprResul.value instanceof PrimitiveValue) {
                return { value: new PrimitiveValue(exprResul.value.type, -exprResul.value.rawValue), variable: exprResul.variable };
            } else {
                console.error('Expressão unária não encontrada');
                return null;
            }
        } else if (unaryExpr.operator == '+') {
            // Aqui não precisa fazer nada
            return { value: exprResul.variable.value, variable: exprResul.variable };
        } else {
            console.error('Erro expressão unária só funciona com primitiva');
        }
    }


    public resolveBinaryExpr(op: string, lhs: ExecuteExprResult, rhs: ExecuteExprResult): Value {
        if (lhs.value instanceof PrimitiveValue && rhs.value instanceof PrimitiveValue) {
            if (util.Operators.isAssignmentOperator(op)) {
                let newValue = lhs.leftOriginalRawValue;
                eval('newValue ' + op + ' rhs.value.rawValue');
                lhs.value.rawValue = newValue;
                return new PrimitiveValue(lhs.value.type, lhs.value.rawValue);
            }

            // Concatenação de string com qualquer outro tipo
            if (lhs.value.type.getTypeName() == 'String' || rhs.value.type.getTypeName() == 'String') {
                let left = lhs.value.rawValue;
                let right = rhs.value.rawValue;
                return this.concatString(left, lhs.value.type.getTypeName(), right, rhs.value.type.getTypeName());
            }

            let rawValue = eval(lhs.value.rawValue + ' ' + op + ' ' + rhs.value.rawValue);
            if (typeof rawValue == 'boolean') {
                return new PrimitiveValue(this.program.resolveType('boolean'), rawValue);
            } else {
                if (lhs.value.type.getTypeName() == 'double' || rhs.value.type.getTypeName() == 'double') {
                    return new PrimitiveValue(this.program.resolveType('double'), rawValue);
                } else {
                    if (rawValue < 0) {
                        return new PrimitiveValue(this.program.resolveType('int'), Math.ceil(rawValue));
                    } else {
                        return new PrimitiveValue(this.program.resolveType('int'), Math.floor(rawValue));
                    }
                }
            }
        } else {
            // Quando um dos dois for objeto, ou está tentando realizar atribuição ou comparando se é igual ou diferente
            if (op == '=') {
                lhs.variable.value = rhs.value;
                return lhs.variable.value;
            } else if (op == '==') {
                if (lhs.value instanceof ObjectValue && rhs.value instanceof ObjectValue) {
                    return new PrimitiveValue(this.program.resolveType('boolean'), lhs.value == rhs.value);
                } else {
                    return new PrimitiveValue(this.program.resolveType('boolean'), false);
                }
            } else if (op == '!=') {
                if (lhs.value instanceof ObjectValue && rhs.value instanceof ObjectValue) {
                    return new PrimitiveValue(this.program.resolveType('boolean'), lhs.value != rhs.value);
                } else {
                    return new PrimitiveValue(this.program.resolveType('boolean'), true);
                }
            } else {
                if (op == '+') {
                    // Verifica concatenação de string
                    let lValue: any;
                    let rValue: any;
                    let lType: string;
                    let rType: string;

                    if (lhs.value instanceof ObjectValue && lhs.value.getType().getTypeName() == 'String') {
                        let internalString = lhs.value.resolveVariableSafe('internalString').value;
                        if (internalString instanceof PrimitiveValue) {
                            lValue = internalString.rawValue;
                            lType = 'String';
                        }
                    } else if (lhs.value instanceof PrimitiveValue) {
                        lValue = lhs.value.rawValue;
                        lType = lhs.value.getType().getTypeName();
                    }

                    if (rhs.value instanceof ObjectValue && rhs.value.getType().getTypeName() == 'String') {
                        let internalString = rhs.value.resolveVariableSafe('internalString').value;
                        if (internalString instanceof PrimitiveValue) {
                            rValue = internalString.rawValue;
                            rType = 'String';
                        }
                    } else if (rhs.value instanceof PrimitiveValue) {
                        rValue = rhs.value.rawValue;
                        rType = rhs.value.getType().getTypeName();
                    }

                    if (typeof lValue != 'undefined' && typeof rValue != 'undefined') {
                        return this.concatString(lValue, lType, rValue, rType);
                    }
                }
                console.error('ERRO: resolução de expr binária entre objeto e algo')
            }
        }
        // if (util.Operators.isArithmeticOperator(op)) {
        //     // Verifica se não está tentando concatenar strings, por que é o único
        //     // objeto que aceita operador aritimético
        //     if (lhsValue instanceof ObjectValue || rhsValue instanceof ObjectValue) {
        //
        //     } else {
        //
        //     }
        // }
    }

    private concatString(lValue: any, lType: string, rValue: any, rType: string) {
        let left = lValue;
        let right = rValue;
        if (lType == 'double' && (left % 1 == 0)) {
            left += '.0';
        } else if (rType == 'double' && (right % 1 == 0)) {
            right += '.0';
        }
        return new PrimitiveValue(this.program.resolveType('String'), left + right);
    }

}

/**
 * Realiza a iteração começando pela classe pai.
 */
export class ClassRootIterator<T extends BaseClass> implements util.Iterator<T> {
    protected arr: Array<T> = [];
    protected idx: number = -1;
    protected processedClasses: { [id: string]: boolean } = {};

    constructor(arr: Array<T>) {
        for (let i = 0; i < arr.length; i++) {
            let classesToProcess = arr[i].getClassCompabilityArray();
            classesToProcess.reverse();

            // Adiciona somente classes não repetidas
            for (let j = 0; j < classesToProcess.length; j++) {
                let currentClass = <T>classesToProcess[j];
                if (typeof this.processedClasses[currentClass.getTypeName()] == 'undefined') {
                    this.arr.push(currentClass);
                    this.processedClasses[currentClass.getTypeName()] = true;
                }
            }
        }
    }

    hasNext(): boolean {
        return this.idx < (this.arr.length - 1);
    }

    next(): T {
        this.idx++;
        return this.arr[this.idx];
    }
}

export class Variable {
    // Identificador que guarda quando esta variavel foi criada, desta forma é possível
    // saber se ela foi declarada anteriormente ou posteriormente
    order: number;
    name: string;
    type: Type;
    value: Value;
    isStatic: boolean = false;
    initializerNode: Ast.ExprNode = null;
    accessModifier: util.AccessModifier = util.AccessModifier.Public;
    ownerContext: BaseScope;
    variableDeclaration: Ast.VariableDeclaration = null;

    // Contador para auxiliar a criação do id
    static counter: number = 0;

    constructor(name: string, type: Type) {
        this.name = name;
        this.type = type;
        this.value = type.getDefaultValue();
        this.order = ++Variable.counter;
    }

    cloneDeclaration(): Variable {
        let v = new Variable(this.name, this.type);
        v.isStatic = this.isStatic;
        v.initializerNode = this.initializerNode;
        v.order = this.order; // reseta ordem
        v.accessModifier = this.accessModifier;
        v.variableDeclaration = this.variableDeclaration;
        return v;
    }
}

export class ArgumentDeclaration {
    name: string;
    type: Type;
}

export abstract class BaseScope implements Scope {
    parentScope: Scope;
    protected variables: { [id: string]: Variable } = {};
    protected variablesNonStatic: { [id: string]: Variable } = {};
    staticContext: boolean = false;
    ownerClass: BaseClass;
    objectValue: ObjectValue = null;

    constructor(parentScope: Scope, ownerClass: BaseClass) {
        this.parentScope = parentScope;
        this.ownerClass = ownerClass;

        // Guarda objeto ao qual se refere
        if (this.parentScope instanceof BaseScope && this.parentScope.objectValue != null) {
            this.objectValue = this.parentScope.objectValue;
        } else if (this.parentScope instanceof ObjectValue) {
            this.objectValue = this.parentScope;
        }
    }

    defineVariable(variable: Variable): void {
        if (typeof this.variables[variable.name] != 'undefined') {
            throw new Parser.ParserException("Variável " + variable.name + " já foi definida");
        } else {
            this.variables[variable.name] = variable;
            if (variable.isStatic == false) {
                this.variablesNonStatic[variable.name] = variable;
            }
            variable.ownerContext = this;
        }
    }

    clarVariables(): void {
        this.variables = {};
    }

    resolveType(type: string): Type {
        return this.parentScope.resolveType(type);
    }

    getVariables(): { [id: string]: Variable } {
        return this.variables;
    }

    getNonStaticVariables(): { [id: string]: Variable } {
        return this.variablesNonStatic;
    }

    resolveVariableSafeNonRecursive(name: string): Variable {
        if (typeof this.variables[name] != 'undefined') {
            return this.variables[name];
        }

        return null;
    }

    resolveVariableSafe(name: string, toScope: BaseScope = null): Variable {
        let variable = this.resolveVariableSafeNonRecursive(name);

        if (variable == null) {
            if (this.parentScope instanceof BaseScope) {
                if (toScope != null && toScope == this.parentScope) {
                    variable = this.parentScope.resolveVariableSafeNonRecursive(name);
                } else {
                    variable = this.parentScope.resolveVariableSafe(name, toScope);
                }
            }
        }

        return variable;
    }

    getMethodSafe(name: string, argsType: Array<Type>): BaseMethod {
        return this.ownerClass.getMethodSafe(name, argsType);
    }
}

export class ScopeResolver {
    depth: number = 0;
    originalScope: BaseScope;

    cloneScopeResolver(): ScopeResolver {
        let clonedScope = new ScopeResolver();
        clonedScope.originalScope = this.originalScope;
        return clonedScope;
    }
}

export class PrimitiveType implements Type {
    protected name: string;
    variableType: boolean = true;
    defaultValue: () => Value = null;
    fncCompatible: (t: Type) => boolean = null;

    constructor(name: string) {
        this.name = name;
    }

    isVariableType(): boolean {
        return this.variableType;
    }

    getTypeName(): string {
        return this.name;
    }

    getDefaultValue(): Value {
        return this.defaultValue();
    }

    isCompatible(t: Type): boolean {
        if (this.fncCompatible != null) return this.fncCompatible(t);
        return t.getTypeName() == this.name;
    }
}

export class PrimitiveValue implements Value {
    type: Type;
    rawValue: any;

    constructor(t: Type, rawValue: any) {
        this.type = t;
        this.rawValue = rawValue;
    }

    getType(): Type {
        return this.type;
    }
}

export class LocalScope extends BaseScope {
    constructor(parentScope: Scope, ownerClass: BaseClass, isStatic: boolean) {
        super(parentScope, ownerClass);
        this.staticContext = isStatic;
    }
}

export abstract class BaseClass extends BaseScope implements Type {
    protected name: string;
    protected program: Program;
    protected superClass: BaseClass = null;
    public staticExecuted: boolean = false;
    protected methods: { [id: string]: Array<BaseMethod> } = {};
    protected methodsBySignature: { [id: string]: BaseMethod } = {};
    protected constructors: Array<BaseMethod> = [];
    protected constructorsBySignature: { [id: string]: BaseMethod } = {};
    protected classCompability: { [id: string]: BaseClass } = {};
    protected classCompabilityArray: Array<BaseClass> = [];
    protected rootClass: BaseClass = null;
    public tempObjectScope: ObjectValue = null;

    constructor(program: Program, name: string) {
        super(program, null);
        this.ownerClass = this;
        this.name = name;
        this.staticContext = true;
        this.program = program;
    }

    getProgram(): Program {
        return this.program;
    }

    isVariableType(): boolean {
        return true;
    }

    getDefaultValue(): Value {
        return new PrimitiveValue(this.program.resolveType('null'), null);
    }

    getTypeName(): string {
        return this.name;
    }

    getExtendedClass(): BaseClass {
        return this.superClass;
    }

    /**
     * Retorna classe no topo da cadeia de herança desta classe.
     * OBS.: Este método só pode ser invocado após a invocação do método updateClassesDiscovered.
     * @return {BaseClass}
     */
    getRootClass(): BaseClass {
        return this.rootClass;
    }

    setExtendedClass(baseClass: BaseClass): void {
        this.superClass = baseClass;
        this.parentScope = baseClass;
    }

    getMethodsIndexedName(): { [id: string]: Array<BaseMethod> } {
        return this.methods;
    }

    getMethods(): Array<BaseMethod> {
        let methods: Array<BaseMethod> = [];
        for (let methodName in this.methods) {
            let methodsSameName = this.methods[methodName];
            for (let i = 0; i < methodsSameName.length; i++) {
                methods.push(methodsSameName[i]);
            }
        }
        return methods;
    }

    addMethod(baseMethod: BaseMethod): void {
        if (typeof this.methods[baseMethod.getMethodName()] == 'undefined') {
            this.methods[baseMethod.getMethodName()] = new Array<BaseMethod>();
        }

        this._addMethod(baseMethod, this.methods[baseMethod.getMethodName()], this.methodsBySignature);
    }

    addConstructor(baseMethod: BaseMethod): void {
        baseMethod.isConstructor = true;
        this._addMethod(baseMethod, this.constructors, this.constructorsBySignature);
    }

    private _addMethod(baseMethod: BaseMethod, methods: Array<BaseMethod>, methodsBySignature: { [id: string]: BaseMethod }): void {
        if (typeof methodsBySignature[baseMethod.getMethodSignature()] != 'undefined') {
            let range: util.ISourceRange = null;

            if (baseMethod instanceof UserMethod) {
                range = baseMethod.getMethodDeclaration().sourceRange;
            }

            throw new Parser.CompileParserException(
                "Método " + baseMethod.getMethodSignature() + " já está definido",
                range,
                this.name
            );
        }

        methodsBySignature[baseMethod.getMethodSignature()] = baseMethod;
        methods.push(baseMethod);
        baseMethod.setOwnerClass(this);
    }

    getConstructors(): Array<BaseMethod> {
        return this.constructors;
    }

    hasConstructor(argsType: Array<Type>): boolean {
        return this._getMethod(this.constructors, this.name, argsType) != null;
    }

    getConstructor(argsType: Array<Type>): BaseMethod {
        return this._getMethod(this.constructors, this.name, argsType);
    }

    getMethodSafe(name: string, argsType: Array<Type>): BaseMethod {
        let method = this._getMethod(this.methods[name], name, argsType);

        if (method == null && this.superClass != null) {
            method = this.superClass.getMethodSafe(name, argsType);
        }

        return method;
    }

    getMethodBySignature(signature: string): BaseMethod {
        if (typeof this.methodsBySignature[signature] != 'undefined') {
            return this.methodsBySignature[signature];
        }
        return null;
    }

    hasMethodBySignature(signature: string): boolean {
        return typeof this.methodsBySignature[signature] != 'undefined';
    }

    _getMethod(methods: Array<BaseMethod>, name: string, argsType: Array<Type>): BaseMethod {
        // Verifica se existe algum método com este nome
        if (typeof methods == 'undefined' || methods.length == 0) {
            return null;
        }

        // Verifica a compatibilidade dos argumentos com cada definição de função
        for (let i = 0; i < methods.length; i++) {
            if (methods[i].matchArguments(argsType)) {
                return methods[i];
            }
        }

        return null;
    }

    /**
     * Verifica se esta classe é um subtipo da classe informada.
     * @param  {BaseClass} baseClass
     * @return {boolean}
     */
    isCompatible(t: Type): boolean {
        return typeof this.classCompability[t.getTypeName()] != 'undefined';
    }

    getClassCompabilityArray(): Array<BaseClass> {
        return this.classCompabilityArray.slice();
    }

    updateClassesDiscovered(): void {
        // Atualiza a lista de classes compatíveis com essa (que são pai)
        // também atualizando o rootClass
        this.rootClass = this;
        this.classCompability[this.rootClass.name] = this.rootClass;
        this.classCompabilityArray.push(this.rootClass);

        while (this.rootClass.superClass != null) {
            this.rootClass = this.rootClass.superClass;
            this.classCompability[this.rootClass.name] = this.rootClass;
            this.classCompabilityArray.push(this.rootClass);
        }
    }

}

export class UserClass extends BaseClass {
    protected classDeclaration: Ast.ClassDeclaration;

    constructor(program: Program, classDeclaration: Ast.ClassDeclaration) {
        super(program, classDeclaration.name);
        this.classDeclaration = classDeclaration;
    }

    getClassDeclaration(): Ast.ClassDeclaration {
        return this.classDeclaration;
    }
}

export class NativeClass extends BaseClass {
    initStatics(): void { }
    declareMembers(): void { }
}

export abstract class BaseMethod {
    protected ownerClass: BaseClass = null;
    protected methodStatic: boolean = false;
    protected accessModifier: util.AccessModifier = util.AccessModifier.Public;
    protected name: string;
    protected arguments: Array<ArgumentDeclaration> = [];
    protected signature: string;
    protected returnType: Type;
    public isConstructor: boolean = false;
    protected hideAutocomplete: boolean = false;

    public getArguments(): Array<ArgumentDeclaration> {
        return this.arguments;
    }

    public setArguments(arg: Array<ArgumentDeclaration>): void {
        this.arguments = arg;
        this.updateSignature();
    }

    getMethodName(): string {
        return this.name;
    }

    getAccessModifier(): util.AccessModifier {
        return this.accessModifier;
    }

    setAccessModifier(access: util.AccessModifier): void {
        this.accessModifier = access;
    }

    setOwnerClass(ownerClass: BaseClass): void {
        this.ownerClass = ownerClass;
    }

    getMethodSignature(): string {
        return this.signature;
    }

    isStatic(): boolean {
        return this.methodStatic;
    }

    setStatic(v: boolean) {
        this.methodStatic = v;
    }

    getOwnerClass(): BaseClass {
        return this.ownerClass;
    }

    getReturnType(): Type {
        return this.returnType;
    }

    /**
     * Verifica se a lista de argumentos é a esperada pelo método.
     * @param  {Array<Type>} args [description]
     * @return {boolean}          [description]
     */
    matchArguments(args: Array<Type>): boolean {
        // Verifica se a quantidade de argumentos são o mesmo
        if (args.length != this.arguments.length) {
            return false;
        }

        // Verifica se cada argumento é compatível
        for (let i = 0; i < args.length; i++) {
            if (args[i].isCompatible(this.arguments[i].type) == false) {
                return false;
            }
        }

        return true;
    }

    protected updateSignature(): void {
        let argTypes = [];

        if (this.arguments.length > 0) {
            for (let i = 0; i < this.arguments.length; i++) {
                argTypes.push(this.arguments[i].type);
            }
        }

        this.signature = generateMethodSignature(this.name, argTypes);
    }

    public setHideAutocomplete(hide: boolean): void {
        this.hideAutocomplete = hide;
    }

    public getHideAutocomplete(): boolean {
        return this.hideAutocomplete;
    }
}

export class UserMethod extends BaseMethod {
    protected methodDeclaration: Ast.MethodDeclaration;

    constructor(methodDec: Ast.MethodDeclaration, methodArguments: Array<ArgumentDeclaration>, returnType: Type) {
        super();

        this.methodStatic = methodDec.isStatic;
        this.accessModifier = methodDec.accessModifier;
        this.name = methodDec.name;
        this.arguments = methodArguments;
        this.returnType = returnType;

        this.methodDeclaration = methodDec;

        this.updateSignature();
    }

    getMethodDeclaration() {
        return this.methodDeclaration;
    }
}

export class NativeMethod extends BaseMethod {
    implementation: (baseScope: BaseScope, args: Array<Value>) => Value = null;

    constructor(name: string, returnType: Type) {
        super();

        this.name = name;
        this.returnType = returnType;

        this.updateSignature();
    }

    updateSignature() {
        return super.updateSignature();
    }

    setImplementation(fnc: (baseScope: BaseScope, args: Array<Value>) => Value) {
        this.implementation = fnc;
    }

    createArguments(program: Program, args: Array<string>): Array<ArgumentDeclaration> {
        let arr = [];
        for (let i = 0; i < args.length; i++) {
            let argumentDeclaration = new ArgumentDeclaration();
            argumentDeclaration.name = 'temp';
            argumentDeclaration.type = program.resolveType(args[i]);
            arr.push(argumentDeclaration);
        }
        return arr;
    }
}

export class Program implements Scope {
    protected types: { [id: string]: Type } = {};
    protected classes: { [id: string]: BaseClass } = {};
    protected primitives: { [id: string]: PrimitiveType } = {};
    public expressionResolver: ExpressionResolver;
    public out: string = '';
    public outError: string = '';

    constructor() {
        this.expressionResolver = new ExpressionResolver(this);
    }

    defineType(type: Type): boolean {
        if (typeof this.types[type.getTypeName()] != 'undefined') {
            return false;
        }

        if (type instanceof BaseClass) {
            this.classes[type.getTypeName()] = type;
        }

        if (type instanceof PrimitiveType) {
            this.primitives[type.getTypeName()] = type;
        }

        this.types[type.getTypeName()] = type;
        return true;
    }

    resolveClass(type: string): BaseClass {
        let baseClass = this.types[type];
        if (baseClass instanceof BaseClass) {
            return baseClass;
        }
        return null;
    }

    resolveType(type: string): Type {
        return this.types[type];
    }

    // TODO: substituir pela resolveType
    resolveType2(type: string): Type {
        return this.types[type];
    }

    getTypes(): { [id: string]: Type } {
        return this.types;
    }

    getClasses(): { [id: string]: BaseClass } {
        return this.classes;
    }

    getClass(className: string): BaseClass {
        return this.classes[className];
    }

    /**
     * Atualiza classes uma vez que todas as classes já foram descobertas.
     */
    updateClassesDiscovered(): void {
        for (let name in this.classes) {
            this.classes[name].updateClassesDiscovered();
        }
    }

}

export class ObjectValue extends BaseScope implements Value {
    protected myClass: BaseClass;
    rootObjectValue: ObjectValue;

    /**
     * Variável utilizada pelas classes nativas para controlar qualquer coisa
     * relativo ao objeto.
     * @type {any}
     */
    public native: any;

    /**
     * Escopo do objeto da classe pai
     * @type {ObjectValue}
     */
    fatherScope: ObjectValue;

    /**
     * Escopo do objeto da classe filha
     * @type {ObjectValue}
     */
    childScope: ObjectValue;

    protected mapObjScope: { [id: string]: ObjectValue } = {};

    constructor(baseClass: BaseClass, childScope: ObjectValue = null) {
        super(baseClass, baseClass);

        this.staticContext = false;
        this.objectValue = this;

        this.myClass = baseClass;
        this.childScope = childScope;

        if (childScope == null) {
            this.rootObjectValue = this;
        } else {
            this.rootObjectValue = this.childScope.rootObjectValue;
        }

        this.rootObjectValue.mapObjScope[baseClass.getTypeName()] = this;

        // Declara todas variáveis deste escopo
        let variables = baseClass.getNonStaticVariables();
        for (var name in variables) {
            this.defineVariable(variables[name].cloneDeclaration());
        }

        let extendedClass = baseClass.getExtendedClass();
        if (extendedClass != null) {
            this.fatherScope = new ObjectValue(extendedClass, this);
        }
    }

    getType(): Type {
        return this.myClass;
    }

    getClass(): BaseClass {
        return this.myClass;
    }

    resolveVariableSafeNonRecursive(name: string): Variable {
        let variable = super.resolveVariableSafeNonRecursive(name);

        if (variable == null) {
            variable = this.myClass.resolveVariableSafeNonRecursive(name);
        }

        if (variable == null && this.fatherScope != null) {
            variable = this.fatherScope.resolveVariableSafeNonRecursive(name);
        }

        return variable;
    }

    getMethodSafe(name: string, argsType: Array<Type>): BaseMethod {
        // Primeiro procura por um método estático no mesmo contexto do objeto
        let method = super.getMethodSafe(name, argsType);
        if (method != null && method.isStatic()) {
            return method;
        }

        if (this.childScope != null) {
            return this.rootObjectValue.getMethodSafe(name, argsType);
        }

        return method;
    }

    getObjClassContext(baseClass: BaseClass): ObjectValue {
        return this.rootObjectValue.mapObjScope[baseClass.getTypeName()];
    }

    getMethodOnlyUp(name: string, argsType: Array<Type>): BaseMethod {
        return super.getMethodSafe(name, argsType);
    }
}
