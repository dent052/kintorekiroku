import re,sys,os
t=open(sys.argv[1],encoding='utf-8').read()
# use the last occurrence of each file (final answer comes last in the log)
files={}
for m in re.finditer(r'^=== FILE: (\S+) ===\n(.*?)^=== END FILE ===', t, re.S|re.M):
    files[m.group(1)]=m.group(2)
for p,c in files.items():
    assert not p.startswith(('/','..')) and '..' not in p, p
    os.makedirs(os.path.dirname(p) or '.',exist_ok=True)
    open(p,'w',encoding='utf-8').write(c); print('wrote',p,len(c.splitlines()),'lines')
