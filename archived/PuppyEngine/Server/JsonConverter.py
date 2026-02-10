from typing import Dict


class JsonConverter:
    def __init__(
        self,
        latest_version
    ):
        self.latest_version = latest_version

    def convert(
        self,
        old_json: Dict[str, dict]
    ) -> Dict[str, dict]:
        # Update the version field
        old_json['version'] = self.latest_version

        # Assuming the inner structure of blocks and edges should remain unchanged
        # If there are specific changes needed, they should be implemented here

        return old_json


if __name__ == "__main__":
    old_json = {
        "blocks": {
            "block1": {
                "type": "text",
                "data": {
                    "content": "Hello World!"
                }
            }
        },
        "edges": {
            "edge1": {
                "data": {
                    "inputs": {
                        "block1": "block1"
                    },
                    "outputs": {
                        "block1": "block1"
                    }
                }
            }
        },
        "version": "0.1"
    }
    
    converter = JsonConverter("0.2")
    new_json = converter.convert(old_json)
    
    print(new_json)
