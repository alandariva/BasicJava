
import { compileAndExecuteFiles, getFileContents } from "../../util";

test('general fibonacci', () => {
    let out = compileAndExecuteFiles([__dirname + '/Fibonacci.java']);

    let expected = getFileContents(__dirname + '/fibonacci.out.txt');

    expect(out).toBe(expected);
});
