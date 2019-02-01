import { BasicJavaParser } from "../src/Parser";
import Interpreter = require("../src/Runtime_Interpreter");
import { Exception } from "../src/Util";

const fs = require('fs');

export function getFileContents(path): string {
    return fs
        .readFileSync(path, 'utf8')
        // normalize new line to \r\n
        .replace(/\r?\n/g, "\r\n");
}

export function compileAndExecuteFiles(files: string[]): string {
    let codes = {};

    for (let i = 0; i < files.length; i++) {
        codes['file-' + i] = getFileContents(files[i]);
    }

    let parser = new BasicJavaParser();
    let program = parser.parse(codes);

    var interpreter = new Interpreter(program);
    var method = interpreter.findMainMethod();

    if (method == null) {
        throw 'Main method not found';
    }

    interpreter.executeStaticMethod(method);
    return program.out;
}

export function compileAndExecuteFolder(folder: string): string {
    let files = fs.readdirSync(folder);
    let filesCompletePath: string[] = [];

    for (let i = 0; i < files.length; i++) {
        filesCompletePath.push(folder + '/' + files[i]);
    }

    return compileAndExecuteFiles(filesCompletePath);
}