
declare class BasicJavaVisitor {
    public visit(ctx: any): any;
}

export { BasicJavaLexer } from '../generated/antlr/BasicJavaLexer';
export { BasicJavaListener } from '../generated/antlr/BasicJavaListener';
export { BasicJavaParser as BaseBasicJavaParser } from '../generated/antlr/BasicJavaParser';
export { BasicJavaVisitor } from '../generated/antlr/BasicJavaVisitor';