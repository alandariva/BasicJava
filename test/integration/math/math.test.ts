
import { compileAndExecuteFiles, getFileContents } from "../../util";

test('general hello world', () => {
    let out = compileAndExecuteFiles([__dirname + '/Math.java']);
    let expected = getFileContents(__dirname + '/math.out.txt');

    expect(out).toBe(expected);
});
