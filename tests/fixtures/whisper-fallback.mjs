const action = process.argv[2];
if (action === "hang") setInterval(() => {}, 1000);
else if (action === "error") { process.stderr.write("private internal fixture\n"); process.exit(2); }
else if (action === "invalid") process.stdout.write('{"text":1,"segments":[]}');
else process.stdout.write(JSON.stringify({ text: "脚本中文🚀", segments: [{ start: 0, end: 1, text: "脚本中文🚀" }], language: "zh" }));
