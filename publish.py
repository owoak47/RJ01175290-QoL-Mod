import pathlib,hashlib,json,zipfile,re
b=pathlib.Path('bundle')
m=json.loads((b/'manifest.json').read_text(encoding='utf-8'))
assert m['id']=='RJ01175290-QoL-Mod' and re.fullmatch(r'\d+\.\d+\.\d+',m['version'])
allowed={'Install.cmd','Uninstall.cmd','Update.cmd','Manage-Mod.ps1','Update-Mod.ps1','README.zh-TW.md','SHA256SUMS.txt','manifest.json'}|{'plugins/'+x['name']+'.js' for x in m['modules']}
actual={p.relative_to(b).as_posix() for p in b.rglob('*') if p.is_file()}
assert actual==allowed
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
checked=set()
for line in (b/'SHA256SUMS.txt').read_text().splitlines():
 expected,name=line.split('  ',1)
 assert name in allowed and sha(b/name)==expected
 checked.add(name)
assert checked==allowed-{'SHA256SUMS.txt'}
for x in m['modules']:assert sha(b/'plugins'/(x['name']+'.js'))==x['sha256']
with zipfile.ZipFile('RJ01175290-QoL-Mod.zip','w',zipfile.ZIP_DEFLATED,compresslevel=9) as z:
 for p in sorted(b.rglob('*')):
  if p.is_file():z.write(p,'RJ01175290-QoL-Mod-'+m['version']+'/'+p.relative_to(b).as_posix())
pathlib.Path('release-notes.md').write_text('朋友版便利功能 Mod '+m['version']+'。解壓縮後執行 Update.cmd；之後使用桌面的更新捷徑。支援 '+ '、'.join(m['gameVersions'])+'。請先備份遊戲進度，並在安裝前關閉遊戲。',encoding='utf-8')
print('Validated package:',m['version'])
