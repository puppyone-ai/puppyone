"""Run one Railway GraphQL request. Usage: gql.py account|project QUERY_FILE [VARS_JSON_FILE]

Prints only the response JSON; never prints tokens.
"""
import json
import os
import sys
import urllib.request

mode, query_file = sys.argv[1], sys.argv[2]
variables = json.load(open(sys.argv[3])) if len(sys.argv) > 3 else {}
if mode == "account":
    user = json.load(open(os.path.expanduser("~/.railway/config.json")))["user"]
    headers = {"Authorization": "Bearer " + (user.get("accessToken") or user["token"])}
else:
    config = json.load(open(os.environ.get("ACCEPT_RELEASE_CONFIG", os.path.expanduser("~/.secrets/qubits-release-config.json"))))
    headers = {"Project-Access-Token": config["railway_token"]}
headers["Content-Type"] = "application/json"
headers["User-Agent"] = "puppyone-release-tools/1"
body = json.dumps({"query": open(query_file).read(), "variables": variables}).encode()
request = urllib.request.Request("https://backboard.railway.com/graphql/v2", data=body, headers=headers)
opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
try:
    with opener.open(request, timeout=60) as response:
        print(json.dumps(json.load(response), indent=1))
except urllib.error.HTTPError as error:
    print("HTTP", error.code, error.read().decode()[:2000])
