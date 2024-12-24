from typing import List, Dict, Union


class StructuredConverter:
    def __init__(
        self,
        structured_text: Union[List, Dict]
    ):
        self.structured_text = structured_text

    def set_structured_text(
        self,
        structured_text: Union[List, Dict]
    ):
        self.structured_text = structured_text

    def convert_to_embedding_view(
        self,
        content_key: str = None
    ) -> List[Dict]:
        """
        Convert the structured text into the embedding view.

        Returns:
            List[Dict]: The embedding view with content and metadata.
        """

        if isinstance(self.structured_text, list):
            return self._convert_list(content_key)
        elif isinstance(self.structured_text, dict):
            return self._convert_dict(content_key)
        else:
            raise ValueError("Unsupported structured text format. Only list and dict are supported.")

    def _convert_list(
        self,
        content_key: str = None
    ) -> List[Dict]:
        """
        Convert a list into the embedding view.

        Args:
            data (List): The list to convert.

        Returns:
            List[Dict]: The embedding view of the list.
        """

        embedding_view = []

        if all(isinstance(item, dict) for item in self.structured_text):  # Handle list of dicts
            for idx, item in enumerate(self.structured_text):
                content = item.get(content_key, "")
                metadata = {key: value for key, value in item.items() if key != content_key}
                metadata["id"] = str(idx)
                embedding_view.append({"content": content, "metadata": metadata})
        else:  # Handle list of strings
            for idx, item in enumerate(self.structured_text):
                embedding_view.append({"content": item, "metadata": {"id": str(idx)}})

        return embedding_view

    def _convert_dict(
        self,
        content_key: str = None
    ) -> List[Dict]:
        """
        Convert a dictionary into the embedding view.

        Args:
            data (Dict): The dictionary to convert.

        Returns:
            List[Dict]: The embedding view of the dictionary.
        """
    
        embedding_view = []
        
        content = self.structured_text.get(content_key, "")

        if isinstance(content, list): # Handle dict of lists
            for idx, item in enumerate(content):
                embedding_view.append({
                    "content": item,
                    "metadata": {
                        "id": str(idx),
                        **{k: v for k, v in self.structured_text.items() if k != content_key}
                    }
                })
        else:  # Handle dict of strings
            metadata = {k: v for k, v in self.structured_text.items() if k != content_key}
            metadata["id"] = "0"
            embedding_view.append({"content": content, "metadata": metadata})

        return embedding_view


if __name__ == "__main__":
    structured_text_1 = ["A", "B", "C"]
    structured_text_2 = {
        "name": "abc",
        "age": 50,
        "description": "some random text"
    }
    structured_text_3 = [{
        "name": "abc",
        "age": 50,
        "description": "some random text"
    },{
        "name": "abcd",
        "age": 60,
        "description": "some random text 2"
    }]
    structured_text_4 = {
        "name": "abc",
        "age": 50,
        "descriptions": ["some", "random", "text"]
    }
    
    converter = StructuredConverter(structured_text_1)
    print(converter.convert_to_embedding_view())
    converter.set_structured_text(structured_text_2)
    print(converter.convert_to_embedding_view(content_key="description"))
    converter.set_structured_text(structured_text_3)
    print(converter.convert_to_embedding_view(content_key="description"))
    converter.set_structured_text(structured_text_4)
    print(converter.convert_to_embedding_view(content_key="descriptions"))
    