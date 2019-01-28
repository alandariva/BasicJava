
import { compileAndExecuteFolder, getFileContents } from "../../util";

test('general inheritance', () => {
    let out = compileAndExecuteFolder(__dirname + '/java');
    let expected = getFileContents(__dirname + '/inheritance.out.txt');

    expect(out).toBe(expected);
});
