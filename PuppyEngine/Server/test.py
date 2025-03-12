import json
try:
    a = json.loads("[\"A\", \"B\", \"C\"]")
    print(a)
except json.JSONDecodeError as e:
    print(e)