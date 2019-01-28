
import { compileAndExecuteFolder, getFileContents } from "../../util";

test('general expressions', () => {
    let out = compileAndExecuteFolder(__dirname + '/java');
    let expected = getFileContents(__dirname + '/expressions.out.txt');

    expect(out).toBe(expected);
});
