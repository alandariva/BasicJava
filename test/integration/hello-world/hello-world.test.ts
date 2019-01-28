
import { compileAndExecuteFiles } from "../../util";

test('general hello world', () => {
    let out = compileAndExecuteFiles([__dirname + '/HelloWorld.java']);

    expect(out).toBe("Hello, World");
});
