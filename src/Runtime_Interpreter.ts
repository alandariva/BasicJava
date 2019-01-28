
import {
    Program,
    BaseMethod,
    RuntimeException,
    LocalScope,
    UserMethod,
    BaseScope,
    Variable,
    NativeMethod,
    Value,
    ObjectValue,
    BaseClass,
    UserClass,
    NativeClass,
    PrimitiveValue,
    ExpressionResolver,
    Type,
    ReturnException,
    ClassRootIterator,
    ExecuteExprResult,
    ArgumentDeclaration
} from "./Runtime";

import * as Ast from "./Ast";

class Interpreter {
    private program: Program;
    private staticExecuted: boolean = false;
    private expressionResolver: ExpressionResolver;

    public static MAX_ITERATION = 1000;

    constructor(program: Program) {
        this.program = program;
        this.expressionResolver = new ExpressionResolver(this.program);
    }

    findClass(name: string): BaseClass {
        let baseClass = this.program.getClass(name);
        return (typeof baseClass != 'undefined') ? baseClass : null;
    }

    findMainMethod(): BaseMethod {
        return this.findStaticMethod("main(String)");
    }

    findStaticMethod(signature: string): BaseMethod {
        let mainMethod = null;
        let classes = this.program.getClasses();
        for (let key in classes) {
            let methods = classes[key].getMethods();
            for (let i = 0; i < methods.length; i++) {
                if (methods[i].getMethodSignature() == signature && methods[i].isStatic() == true) {
                    if (mainMethod != null) {
                        throw new RuntimeException("Mais de uma classe possúi um método main");
                    }
                    mainMethod = methods[i];
                }
            }
        }
        return mainMethod;
    }

    executeStaticMethod(baseMethod: BaseMethod, args: Array<Value> = []): void {
        if (baseMethod.isStatic() == false) {
            throw new RuntimeException("O método " + baseMethod.getMethodName() + " não é estático");
        }

        // Inicia todas estáticas do programa
        if ( ! this.staticExecuted) {
            let arrClasses = [];
            let objClasses = this.program.getClasses();
            for (let n in objClasses) {
                arrClasses.push(objClasses[n]);
            }

            let it = new ClassRootIterator(arrClasses);

            while (it.hasNext()) {
                let classProcessing = it.next();
                this.initializeStatics(classProcessing);
            }
        }

        let scope = new LocalScope(baseMethod.getOwnerClass(), baseMethod.getOwnerClass(), true);
        this.executeMethod(scope, baseMethod, args);
    }

    private initializeStatics(baseClass: BaseClass): void {
        if (baseClass.staticExecuted) {
            return;
        }

        baseClass.staticExecuted = true;

        if (baseClass instanceof NativeClass) {
            baseClass.initStatics();
        } else {
            let variables = baseClass.getVariables();

            for (let nomeVar in variables) {
                let variable = variables[nomeVar];
                if (variable.isStatic && variable.initializerNode != null) {
                    variable.value = this.executeExpr(baseClass, baseClass, variable.initializerNode).value;
                }
            }
        }
    }

    private executeVariableDeclaration(baseScope: BaseScope, statement: Ast.VariableDeclaration): void {
        let variable = new Variable(statement.name, this.program.resolveType(statement.type));
        variable.isStatic = baseScope.staticContext;
        if (statement.getInitializer() != null) {
            variable.value = this.executeExpr(baseScope, baseScope, statement.getInitializer()).value;
            // Garante que um inteiro vai ter o tipo double
            if (statement.type == 'double' && variable.value instanceof PrimitiveValue) {
                variable.value.type = variable.type;
            }
        }
        baseScope.defineVariable(variable);
    }

    private executeExpr(originalScope: BaseScope, scope: BaseScope, statement: Ast.ExprNode): ExecuteExprResult {
        // if (statement instanceof Ast.NewExprNode) {
        //     let newObject = new ObjectValue(this.program.resolveClass(statement.className));
        //     let baseMethod = newObject.getClass().getConstructor([]);
        //     //this.executeObjectMethod(newObject, baseMethod);
        //     return newObject;
        // }

        if (statement instanceof Ast.PrimitiveExprNode) {
            let pv = new PrimitiveValue(statement.runtimeType, statement.value);
            return {value: pv};
        } else if (statement instanceof Ast.BinaryExpr) {
            let resultLeft = this.executeExpr(originalScope, scope, statement.getLeft());
            if (resultLeft.value instanceof PrimitiveValue) {
                resultLeft.leftOriginalRawValue = resultLeft.value.rawValue;
            }
            let resultRight = this.executeExpr(originalScope, scope, statement.getRight());
            let value = this.expressionResolver.resolveBinaryExpr(statement.operator, resultLeft, resultRight);
            return {value: value};
        } else if (statement instanceof Ast.MethodOrVariable) {
            let originalScope = scope;
            let onlyLookUp = false;
            if (statement.thisOrSuper != null) {
                if (statement.thisOrSuper == 'this') {
                    // Verifica se apenas não foi usado o this
                    if (statement.getMethodOrVariable() == null) {
                        return {value: scope.objectValue};
                    }
                    scope = scope.objectValue;
                } else {
                    scope = scope.objectValue.fatherScope;
                    onlyLookUp = true;
                }
            }
            return this.executeMethodOrVariable(originalScope, scope, statement.getMethodOrVariable(), onlyLookUp);
        } else if (statement instanceof Ast.NewExprNode) {
            let newObject = new ObjectValue(this.program.resolveClass(statement.className));
            let args = this.executeListExpr(originalScope, originalScope, statement.getArgs());

            let baseMethod = newObject.getClass().getConstructor(this.arrValueToType(args));
            this.executeObjectConstructor(newObject, baseMethod, args);
            return {value: newObject};
        } else if (statement instanceof Ast.UnaryExpr) {
            let resultElem = this.executeExpr(originalScope, scope, statement.getElem());
            let value = this.expressionResolver.resolveUnaryExpr(statement, resultElem);
            return value;
        }

        debugger;

        console.log(statement);

        console.error('Expressão não implementada');
        return null;
    }

    private executeObjectConstructor(obj: ObjectValue, baseMethod: BaseMethod, args: Array<Value>): void {
        if (baseMethod instanceof NativeMethod) {
            baseMethod.implementation(obj, args);
            return;
        }

        // Criando escopo de execução do construtor
        let scope = new LocalScope(obj, obj.ownerClass, false);

        // Definindo argumentos
        let methodArguments = baseMethod.getArguments();
        this.defineArguments(scope, methodArguments, args);

        // Como é um constructor, pode ter um super
        if (baseMethod instanceof UserMethod) {
            let statement = baseMethod.getMethodDeclaration().getBlockStatement().getStatements()[0];
            if (typeof statement != 'undefined' && statement instanceof Ast.SuperCall) {
                let argsSuper = this.executeListExpr(scope, scope, statement.getArgs());
                let baseMethodSuper = obj.ownerClass.getExtendedClass().getConstructor(this.arrValueToType(argsSuper));
                this.executeObjectConstructor(obj.fatherScope, baseMethodSuper, argsSuper);
            }
        }

        // Inicializar variáveis
        let variables = obj.getVariables();
        for (let varName in variables) {
            let variable = variables[varName];
            if (variable.initializerNode != null) {
                variable.value = this.executeExpr(obj, obj, variable.initializerNode).value;
            }
        }

        try {
            if (baseMethod instanceof UserMethod) {
                this.executeStatements(scope, baseMethod.getMethodDeclaration().getBlockStatement().getStatements());
            }
        } catch (ex) {
            if (ex instanceof ReturnException == false) {
                throw ex;
            }
        }
    }

    private defineArguments(scope: BaseScope, methodArguments: ArgumentDeclaration[], args: Array<Value>) {
        for (let i = 0; i < methodArguments.length; i++) {
            let methodArgument = methodArguments[i];
            let currentArg = args[i];
            let variable = new Variable(methodArgument.name, methodArgument.type);
            variable.value = currentArg;
            variable.isStatic = scope.staticContext;
            scope.defineVariable(variable);
        }
    }

    public executeMethod(baseScope: BaseScope, baseMethod: BaseMethod, args: Array<Value>): Value {
        if (baseMethod instanceof NativeMethod) {
            return baseMethod.implementation(baseScope, args);
        }

        // Criando escopo de execução para o método
        let scope = new LocalScope(baseScope, baseScope.ownerClass, baseScope.staticContext);

        // Definindo argumentos
        let methodArguments = baseMethod.getArguments();
        this.defineArguments(scope, methodArguments, args);

        try {
            if (baseMethod instanceof UserMethod) {
                this.executeStatements(scope, baseMethod.getMethodDeclaration().getBlockStatement().getStatements());
            }
        } catch (ex) {
            if (ex instanceof ReturnException) {
                return ex.value;
            } else {
                throw ex;
            }
        }

        return null;
    }

    private executeStatements(baseScope: BaseScope, statements: Array<Ast.Statement>): void {
        for (let i = 0; i < statements.length; i++) {
            let statement = statements[i];
            //console.info('executando linha: ' + statement.sourceRange.startLine + ' arquivo: ' + statement.fileName);
            if (statement instanceof Ast.ReturnStatement) {
                if (statement.getExpression()) {
                    let valueReturn = this.executeExpr(baseScope, baseScope, statement.getExpression());
                    throw new ReturnException(valueReturn.value);
                }
                throw new ReturnException(null);
            } else if (statement instanceof Ast.Sysout) {

                if (statement.getExpression()) {
                    let resultExpr = this.executeExpr(baseScope, baseScope, statement.getExpression());
                    let strPrint = '';
                    if (resultExpr.value instanceof PrimitiveValue) {
                        let value = resultExpr.value.rawValue;
                        // Printa double com .0 quando é um inteiro
                        if (resultExpr.value.getType().getTypeName() == 'double') {
                            if (value % 1 == 0) {
                                value += '.0';
                            }
                        }
                        strPrint = value;
                    } else if (resultExpr.value instanceof ObjectValue) {
                        let internalString = resultExpr.value.resolveVariableSafe('internalString');
                        if (internalString != null && internalString.value instanceof PrimitiveValue) {
                            strPrint = internalString.value.rawValue;
                        }
                    }
                    this.program.out += strPrint;
                }

                if (statement.newLine) {
                    this.program.out += "\r\n";
                }

            } else if (statement instanceof Ast.VariableDeclaration) {
                this.executeVariableDeclaration(baseScope, statement);
            } else if (statement instanceof Ast.ExprNode) {
                this.executeExpr(baseScope, baseScope, statement);
            } else if (statement instanceof Ast.IfStatement) {
                let test = this.executeExpr(baseScope, baseScope, statement.getCondition());
                if (test.value instanceof PrimitiveValue) {
                    if (test.value.rawValue) {
                        this.executeStatements(baseScope, [statement.getStatementsIf()]);
                    } else if (statement.getStatementsElse()) {
                        this.executeStatements(baseScope, [statement.getStatementsElse()]);
                    }
                } else {
                    console.error('ERRO TESTANDO CONDIÇÃO DO IF', statement);
                }
            } else if (statement instanceof Ast.ForStatement) {
                let scope = new LocalScope(baseScope, baseScope.ownerClass, baseScope.staticContext);

                // For Init
                let statementForInit = statement.getForInit();
                if (statementForInit instanceof Ast.ExprNode) {
                    this.executeExpr(scope, scope, statementForInit);
                } else if (statementForInit instanceof Ast.VariableDeclaration) {
                    this.executeVariableDeclaration(scope, statementForInit);
                }

                let count = 0;
                // Expression
                while (true) {
                    if (statement.getExpression()) {
                        let returned = this.executeExpr(scope, scope, statement.getExpression());
                        if (returned.value instanceof PrimitiveValue && returned.value.rawValue == false) {
                            break;
                        }
                    }

                    let scopeIteration = new LocalScope(scope, scope.ownerClass, scope.staticContext);
                    this.executeStatements(scopeIteration, [statement.getStatement()]);

                    if (statement.getExpressionList().length > 0) {
                        this.executeStatements(scope, statement.getExpressionList());
                    }

                    count++;
                    if (count == Interpreter.MAX_ITERATION) {
                        throw new RuntimeException("Máximo de 1000 interações atingido");
                    }
                }
            } else if (statement instanceof Ast.WhileStatement) {
                let count = 0;
                // Expression
                while (true) {
                    let returned = this.executeExpr(baseScope, baseScope, statement.getExpression());
                    if (returned.value instanceof PrimitiveValue && returned.value.rawValue == false) {
                        break;
                    }

                    let scopeIteration = new LocalScope(baseScope, baseScope.ownerClass, baseScope.staticContext);
                    this.executeStatements(scopeIteration, [statement.getStatement()]);

                    count++;
                    if (count == Interpreter.MAX_ITERATION) {
                        throw new RuntimeException("Máximo de 1000 interações atingido");
                    }
                }
            } else if (statement instanceof Ast.BlockStatement) {
                this.executeStatements(baseScope, statement.getStatements());
            } else if (statement instanceof Ast.BasicDebug) {
                console.log('<<BASICDEBUG>> arquivo: ' + statement.fileName + ' - linha: ' + statement.sourceRange.startLine);
                debugger;
            }
        }
    }

    private executeMethodOrVariable(originalScope: BaseScope, scope: BaseScope, statement: Ast.MethodOrVariableAccessor, superUsed: boolean = false): ExecuteExprResult {
        if (statement instanceof Ast.Variable) {
            let variable = scope.resolveVariableSafe(statement.name);
            if (variable == null) {
                // Se não achou a variável é por que é o nome de uma classe
                let baseClass = this.program.resolveClass(statement.name);
                this.initializeStatics(baseClass);
                return this.executeMethodOrVariable(originalScope, baseClass, statement.getMethodOrVariable());
            }
            if (statement.getMethodOrVariable() != null) { // Ainda existe mais coisa para ser resolvida
                // Se existe mais coisa a ser resolvida, a variável é um objeto
                if (variable.value instanceof ObjectValue) {
                    scope = variable.value;
                } else {
                    let methodOrVariable = statement.getMethodOrVariable();

                    if (variable.value instanceof PrimitiveValue && variable.value.getType().getTypeName() == "String") {
                        // Transforma a string em objeto e tenta novamente
                        let objValue = new ObjectValue(this.program.getClass('String'));
                        let constructorMethod = objValue.getClass().getConstructor([this.program.resolveType('String')]);
                        this.executeObjectConstructor(objValue, constructorMethod, [variable.value]);
                        variable.value = objValue;

                        return this.executeMethodOrVariable(originalScope, scope, statement, superUsed);
                    }

                    throw new RuntimeException(statement.fileName + ' linha: ' + statement.sourceRange.startLine + ' - '
                        + ' Tentando acessar ' + (methodOrVariable instanceof Ast.MethodCall ? 'método ' : 'variável ')
                        + methodOrVariable.name + ' de valor ' + variable.value.getType().getTypeName());
                }
                return this.executeMethodOrVariable(originalScope, scope, statement.getMethodOrVariable());
            }
            return {value: variable.value, variable: variable};
        } else if (statement instanceof Ast.MethodCall) {
            let args = this.executeListExpr(originalScope, originalScope, statement.getArgs());
            let baseMethod: BaseMethod;
            if (superUsed) {
                // Entra aqui quando precisa somente olhar para métodos e propriedades dos pais
                baseMethod = scope.objectValue.getMethodOnlyUp(statement.name, this.arrValueToType(args));
            } else {
                if (scope.staticContext == false) {
                    // Se for contexto não estático, então tem um objeto...
                    baseMethod = scope.objectValue.getMethodSafe(statement.name, this.arrValueToType(args));
                } else {
                    baseMethod = scope.getMethodSafe(statement.name, this.arrValueToType(args));
                }
            }
            let value: Value;

            if (baseMethod.isStatic()) {
                value = this.executeMethod(scope.ownerClass, baseMethod, args);
            } else {
                let objScope = scope.objectValue.getObjClassContext(baseMethod.getOwnerClass());
                value = this.executeMethod(objScope, baseMethod, args);
            }

            if (statement.getMethodOrVariable() != null) { // Ainda existe mais coisa para ser resolvida
                // Se existe mais coisa a ser resolvida, a variável é um objeto
                if (value instanceof ObjectValue) {
                    scope = value;
                } else {
                    console.error('Um valor que não seja objeto não pode ter um método ou var para ser resolvido');
                }
                return this.executeMethodOrVariable(originalScope, scope, statement.getMethodOrVariable());
            }

            return {value: value};
        }
    }

    private executeListExpr(originalScope: BaseScope, scope: BaseScope, statement: Array<Ast.ExprNode>): Array<Value> {
        let args: Array<Value> = [];
        for (let i = 0; i < statement.length; i++) {
            args.push(this.executeExpr(originalScope, scope, statement[i]).value);
        }
        return args;
    }

    private arrValueToType(arr: Array<Value>): Array<Type> {
        let args: Array<Type> = [];
        for (let i = 0; i < arr.length; i++) {
            args.push(arr[i].getType());
        }
        return args;
    }
}

export = Interpreter;