
import * as util from "./Util";
import * as Runtime from "./Runtime";

export class String extends Runtime.NativeClass {
    constructor(program: Runtime.Program) {
        super(program, "String");
    }

    declareMembers(): void {
        let self = this;
        let constructor: Runtime.NativeMethod;
        let construcParamStr: Runtime.NativeMethod;
        let method: Runtime.NativeMethod;

        let internalStringDec = new Runtime.Variable('internalString', this.program.resolveType('String'));
        internalStringDec.accessModifier = util.AccessModifier.Private;
        this.defineVariable(internalStringDec);

        // Construtor String
        constructor = new Runtime.NativeMethod('String', null);
        constructor.setImplementation(function(baseScope: Runtime.BaseScope, args: Array<Runtime.Value>): Runtime.Value {
            let internalString = baseScope.objectValue.resolveVariableSafe('internalString');
            if (internalString.value instanceof Runtime.PrimitiveValue) {
                internalString.value.rawValue = '';
            }
            return null;
        });
        this.addConstructor(constructor);

        construcParamStr = new Runtime.NativeMethod('String', null);
        construcParamStr.setArguments(construcParamStr.createArguments(this.program, ['String']));
        construcParamStr.setImplementation(function(baseScope: Runtime.BaseScope, args: Array<any>): Runtime.Value {
            let internalString = baseScope.objectValue.resolveVariableSafe('internalString');
            if (internalString.value instanceof Runtime.PrimitiveValue) {
                internalString.value.rawValue = String.normalizeToPrimitive(args[0]).rawValue;
            }
            return null;
        });
        this.addConstructor(construcParamStr);

        method = new Runtime.NativeMethod('equals', this.program.resolveType('boolean'));
        method.setArguments(method.createArguments(this.program, ['String']));
        method.setImplementation(function(baseScope: Runtime.BaseScope, args: Array<any>): Runtime.Value {
            let thisInternalString = baseScope.objectValue.resolveVariableSafe('internalString');
            let thisValue = '';
            if (thisInternalString.value instanceof Runtime.PrimitiveValue) {
                thisValue = thisInternalString.value.rawValue;
            }

            let otherValue = String.normalizeToPrimitive(args[0]).rawValue;

            thisValue = thisValue.replace(/\r?\n/g, "\r\n");
            otherValue = otherValue.replace(/\r?\n/g, "\r\n");

            let returnValue = new Runtime.PrimitiveValue(self.program.resolveType('boolean'), thisValue == otherValue);

            return returnValue;
        });
        this.addMethod(method);

        method = new Runtime.NativeMethod('toLowerCase', this.program.resolveType('String'));
        method.setArguments(method.createArguments(this.program, []));
        method.setImplementation(function(baseScope: Runtime.BaseScope, args: Array<any>): Runtime.Value {
            let thisInternalString = baseScope.objectValue.resolveVariableSafe('internalString');
            let thisValue = '';
            if (thisInternalString.value instanceof Runtime.PrimitiveValue) {
                thisValue = thisInternalString.value.rawValue;
            }

            let returnValue = new Runtime.ObjectValue(self.program.resolveClass('String'));
            let internalString = returnValue.resolveVariableSafe('internalString');
            if (internalString.value instanceof Runtime.PrimitiveValue) {
                internalString.value.rawValue = thisValue.toLowerCase();
            }

            return returnValue;
        });
        this.addMethod(method);
    }

    static normalizeToPrimitive(value: any): Runtime.PrimitiveValue {
        if (value instanceof Runtime.PrimitiveValue) {
            return value;
        } else if (value instanceof Runtime.ObjectValue) {
            let internalString = value.resolveVariableSafe('internalString');
            return new Runtime.PrimitiveValue(internalString.value.getType(), internalString.value);
        }
        console.error('Error converting to a primitive type');
        return value;
    }
}

export class NativeObject extends Runtime.NativeClass {

    constructor(program: Runtime.Program) {
        super(program, "Object");
    }

    declareMembers(): void {

        let constructor = new Runtime.NativeMethod('Object', null);
        constructor.setArguments(constructor.createArguments(this.program, []));
        constructor.setImplementation(function(baseScope: Runtime.BaseScope, args: Array<Runtime.Value>): Runtime.Value {
            return null;
        });

        this.addConstructor(constructor);
    }
}

export function createPrimitiveTypes(): Array<Runtime.PrimitiveType> {
    let primitives = [];
    let primitive: Runtime.PrimitiveType;

    primitive = new Runtime.PrimitiveType("void");
    primitive.variableType = false;
    primitives.push(primitive);

    primitive = new Runtime.PrimitiveType("int");
    primitive.defaultValue = function(): Runtime.Value {
        return new Runtime.PrimitiveValue(this, 0);
    }
    primitive.fncCompatible = function(t: Runtime.Type): boolean {
        let typeName = t.getTypeName();
        return (typeName == 'int' || typeName == 'double');
    }
    primitives.push(primitive);

    primitive = new Runtime.PrimitiveType("boolean");
    primitive.defaultValue = function(): Runtime.Value {
        return new Runtime.PrimitiveValue(this, false);
    }
    primitives.push(primitive);

    primitive = new Runtime.PrimitiveType("double");
    primitive.defaultValue = function(): Runtime.Value {
        return new Runtime.PrimitiveValue(this, 0);
    }
    primitives.push(primitive);

    primitive = new Runtime.PrimitiveType("null");
    primitive.variableType = false;
    primitive.defaultValue = function(): Runtime.Value {
        return new Runtime.PrimitiveValue(this, null);
    }
    primitive.fncCompatible = function(t: Runtime.Type): boolean {
        return t instanceof Runtime.BaseClass;
    }
    primitives.push(primitive);

    return primitives;
}
