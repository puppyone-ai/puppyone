# If you are a VS Code users:
import os
import sys
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from Edges.Generator import lite_llm_chat
from pydantic import BaseModel
from dotenv import load_dotenv
load_dotenv()


# Custom Structured Output
messages = [{"role": "user", "content": "List 5 important events in the XIX century"}]

class CalendarEvent(BaseModel):
  name: str
  date: str
  participants: list[str]

class EventsList(BaseModel):
    events: list[CalendarEvent]

resp = lite_llm_chat(
    model="gpt-4o-2024-08-06",
    messages=messages,
    response_format=EventsList,
    api_key=os.environ.get("DEEPBRICKS_API_KEY")
)
print(resp, type(resp), eval(resp))

# JSON Schema
resp = lite_llm_chat(
  model="gpt-4o-2024-08-06",
  response_format={
      "type": "json_schema",
      "json_schema": {
        "name": "test",
        "schema": {
          "type": "object",
          "properties": {
            "name": {
              "type": "string"
            },
          }
        },
        "required": ["name"]
      }
  },
  messages=[
    {"role": "system", "content": "You are a helpful assistant designed to output JSON."},
    {"role": "user", "content": "Who won the world series in 2020?"}
  ],
  api_key=os.environ.get("DEEPBRICKS_API_KEY")
)

print(resp, type(resp), eval(resp))
