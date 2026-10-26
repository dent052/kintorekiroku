# Applies Codex block output: FILE (whole), FUNCTION (replace in app.js), NEWFUNCTION (append to app.js),
# TEST (replace in e2e), NEWTEST (append to e2e). Usage: python3 docs/handoff/apply-blocks.py OUT.txt
import re, subprocess, sys
out = open(sys.argv[1]).read()
subprocess.run([sys.executable, 'docs/handoff/apply.py', sys.argv[1]], check=True)
app = open('app.js').read()
for name, body in re.findall(r'=== FUNCTION: (\w+) ===\n(.*?)\n=== END FUNCTION ===', out, re.S):
    start = re.search(r'^(async )?function ' + name + r'\(', app, re.M).start()
    end = re.compile(r'^}\n', re.M).search(app, start).end()
    app = app[:start] + body.strip() + '\n' + app[end:]
    print('function', name)
for body in re.findall(r'=== NEWFUNCTION ===\n(.*?)\n=== END NEWFUNCTION ===', out, re.S):
    app = app.rstrip('\n') + '\n\n' + body.strip() + '\n'
    print('new function', body.split('(')[0][:60])
for body in re.findall(r'=== IMPORT ===\n(.*?)\n=== END IMPORT ===', out, re.S):
    app = re.sub(r"^import \{.*?\} from './logic.js';", lambda m: body.strip(), app, count=1, flags=re.S | re.M)
    print('import')
open('app.js', 'w').write(app)
e2e = open('e2e/app.test.mjs').read()
for name, body in re.findall(r'=== TEST: (.+?) ===\n(.*?)\n=== END TEST ===', out, re.S):
    start = e2e.index("test('" + name + "'")
    end = e2e.find('\ntest(', start + 1)
    end = len(e2e.rstrip('\n')) if end < 0 else end + 1
    e2e = e2e[:start] + body.strip() + '\n' + e2e[end:]
    print('test', name)
for body in re.findall(r'=== NEWTEST ===\n(.*?)\n=== END NEWTEST ===', out, re.S):
    e2e = e2e.rstrip('\n') + '\n\n' + body.strip() + '\n'
    print('new test')
open('e2e/app.test.mjs', 'w').write(e2e)
logic = open('logic.test.js').read()
for body in re.findall(r'=== LOGICTEST ===\n(.*?)\n=== END LOGICTEST ===', out, re.S):
    logic = logic.rstrip('\n') + '\n\n' + body.strip() + '\n'
    print('new logic test')
open('logic.test.js', 'w').write(logic)
