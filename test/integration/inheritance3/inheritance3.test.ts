
import { compileAndExecuteFolder, getFileContents } from "../../util";

test('general inheritance3', () => {
    let out = compileAndExecuteFolder(__dirname + '/java');
    let expected = getFileContents(__dirname + '/inheritance3.out.txt');

    expect(out).toBe(expected);
});
