content = open(r'C:\Users\十号\.openclaw\workspace\projects\agentos\plugins\sentinel-agentos\src\index.ts', 'r', encoding='utf-8').read()

idx = content.find('api.on("before_tool_call"')
print(f'api.on("before_tool_call" at: {idx}')

idx2 = content.find('Hook 1')
print(f'Hook 1 at: {idx2}')

# Check if confidence scoring already in before_tool_call
if 'confidenceResult' in content:
    print('Already has confidence scoring in before_tool_call')
else:
    print('No confidence scoring yet')
