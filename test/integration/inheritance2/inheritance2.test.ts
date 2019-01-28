
import { compileAndExecuteFolder, getFileContents } from "../../util";

test('general inheritance2', () => {
    let out = compileAndExecuteFolder(__dirname + '/java');
    let expected = getFileContents(__dirname + '/inheritance2.out.txt');

    expect(out).toBe(expected);
});
