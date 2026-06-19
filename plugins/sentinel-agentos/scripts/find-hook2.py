c = open(r'C:\Users\十号\.openclaw\workspace\projects\agentos\plugins\sentinel-agentos\src\index.ts', 'r', encoding='utf-8').read()

start_marker = 'api.on("before_tool_call"'
hook_end_marker = '}, { priority: 100 });'

start = c.find(start_marker)
s2 = c.find(hook_end_marker, start)

print(f'start={start}, s2={s2}')

if s2 >= 0:
    end = s2 + len(hook_end_marker)
    old_text = c[start:end]
    print(f'Old hook length: {len(old_text)}')
    print(f'First 80: {repr(old_text[:80])}')
    print(f'Last 80: {repr(old_text[-80:])}')
