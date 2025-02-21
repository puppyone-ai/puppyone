from jsonschema import validate, ValidationError


class JsonValidator:
    def __init__(
        self
    ):
        # Define schemas for blocks
        self.block_schemas = {
            "text": {
                "type": "object",
                "properties": {
                    "type": {"type": "string", "const": "text"},
                    "data": {
                        "type": "object",
                        "properties": {
                            "content": {"type": "string"}
                        },
                        "required": ["content"]
                    }
                },
                "required": ["type", "data"]
            },
            "switch": {
                "type": "object",
                "properties": {
                    "type": {"type": "string", "const": "switch"},
                    "data": {
                        "type": "object",
                        "properties": {
                            "content": {"type": "string"}
                        },
                        "required": ["content"]
                    }
                },
                "required": ["type", "data"]
            },
            "structured": {
                "type": "object",
                "properties": {
                    "type": {"type": "string", "const": "structured"},
                    "data": {
                        "type": "object",
                        "properties": {
                            "content": {
                                "type": ["object", "string"],
                                "patternProperties": {
                                    ".*": {  # Matches any key for the index
                                        "type": "object",
                                        "properties": {
                                            "content": {"type": "string"},
                                            "metadata": {
                                                "type": "object",
                                                "patternProperties": {
                                                    ".*": {
                                                        "type": "string"
                                                    }
                                                },
                                                "additionalProperties": False
                                            }
                                        },
                                        "required": ["content", "metadata"]
                                    }
                                },
                                "additionalProperties": False
                            }
                        },
                        "required": ["content"]
                    }
                },
                "required": ["type", "data"]
            },
            "weblink": {
                "type": "object",
                "properties": {
                    "type": {"type": "string", "const": "weblink"},
                    "data": {
                        "type": "object",
                        "properties": {
                            "content": {"type": "string"}
                        },
                        "required": ["content"]
                    }
                },
                "required": ["type", "data"]
            }
        }

        # Define schemas for edges
        self.edge_schemas = {
            "modify": {
                "type": "object",
                "properties": {
                "type": {"type": "string", "const": "modify"},
                "data": {
                    "type": "object",
                    "properties": {
                    "content_type": {"type": "string", "enum": ["str", "structured"]},
                    "modify_type": {
                        "type": "string",
                        "enum": ["deep_copy_string", "get", "modify_text", "modify_structured"]
                    },
                    "content": {
                        "oneOf": [
                        {"type": "string"},
                        {"type": "array", "items": {"type": "string"}}
                        ]
                    },
                    "inputs": {
                        "type": "object",
                        "patternProperties": {
                        ".*": {"type": "string"}
                        }
                    },
                    "outputs": {
                        "type": "object",
                        "patternProperties": {
                        ".*": {"type": "string"}
                        }
                    },
                    "extra_configs": {
                        "type": "object",
                        "properties": {
                        "index": {"type": "integer", "minimum": 0}
                        },
                        "additionalProperties": False
                    },
                    "looped": {"type": "boolean"}
                    },
                    "required": ["modify_type", "inputs", "outputs"]
                }
                },
                "required": ["type", "data"]
            },
            "chunk": {
                "type": "object",
                "properties": {
                "type": {"type": "string", "const": "chunk"},
                "data": {
                    "type": "object",
                    "properties": {
                    "chunking_mode": {
                        "type": "string",
                        "enum": ["auto", "length", "character", "llm"]
                    },
                    "sub_chunking_mode": {
                        "type": "string",
                        "enum": ["size", "character", "llm"]
                    },
                    "inputs": {
                        "type": "object",
                        "patternProperties": {
                        ".*": {"type": "string"}
                        }
                    },
                    "outputs": {
                        "type": "object",
                        "patternProperties": {
                        ".*": {"type": "string"}
                        }
                    },
                    "extra_configs": {
                        "type": "object",
                        "properties": {
                        "chunk_size": {"type": "integer", "minimum": 1},
                        "overlap": {"type": "integer", "minimum": 0},
                        "handle_half_word": {"type": "boolean"},
                        "delimiters": {
                            "type": "array",
                            "items": {"type": "string"}
                        },
                        "model": {"type": "string"},
                        "prompt": {"type": "string"}
                        },
                        "additionalProperties": False
                    },
                    "looped": {"type": "boolean"}
                    },
                    "required": ["chunking_mode", "inputs", "outputs"]
                }
                },
                "required": ["type", "data"]
            },
            "search": {
                "type": "object",
                "properties": {
                "type": {"type": "string", "const": "search"},
                "data": {
                    "type": "object",
                    "properties": {
                    "search_type": {
                        "type": "string",
                        "enum": ["rag", "llm", "web"]
                    },
                    "sub_search_type": {
                        "type": "string",
                        "enum": ["vector", "word", "llm", "google", "perplexity"]
                    },
                    "inputs": {
                        "type": "object",
                        "patternProperties": {
                        ".*": {"type": "string"}
                        }
                    },
                    "outputs": {
                        "type": "object",
                        "patternProperties": {
                        ".*": {"type": "string"}
                        }
                    },
                    "top_k": {"type": "integer", "minimum": 1},
                    "threshold": {"type": "number", "minimum": 0, "maximum": 1},
                    "extra_configs": {
                        "type": "object",
                        "properties": {
                        "provider": {"type": "string"},
                        "model": {"type": "string"},
                        "db_type": {"type": "string"},
                        "collection_name": {"type": "string"},
                        "llm_prompt_template": {"type": "string"}
                        },
                        "additionalProperties": False
                    },
                    "docs_id": {
                        "type": "object",
                        "patternProperties": {
                        ".*": {"type": "string"}
                        }
                    },
                    "query_id": {
                        "type": "object",
                        "patternProperties": {
                        ".*": {"type": "string"}
                        }
                    }
                    },
                    "required": ["search_type", "inputs", "outputs"]
                }
                },
                "required": ["type", "data"]
            }
        }

        # Define the outer schema
        self.outer_schema = {
            "type": "object",
            "properties": {
                "blocks": {
                    "type": "object",
                    "additionalProperties": {"type": "object"}
                },
                "edges": {
                    "type": "object",
                    "additionalProperties": {"type": "object"}
                },
                "version": {"type": "string"}
            },
            "required": ["blocks", "edges", "version"]
        }

    def validate(
        self,
        json_data: dict
    ) -> bool:
        try:
            validate(instance=json_data, schema=self.outer_schema)

            # Validate each block
            for _, block in json_data.get("blocks", {}).items():
                block_type = block.get("type")
                if block_type in self.block_schemas:
                    validate(instance=block, schema=self.block_schemas[block_type])
                else:
                    raise ValidationError(f"Invalid block type: {block_type}")

            # Validate each edge
            for _, edge in json_data.get("edges", {}).items():
                edge_type = edge.get("type")
                if edge_type in self.edge_schemas:
                    validate(instance=edge, schema=self.edge_schemas[edge_type])
                else:
                    raise ValidationError(f"Invalid edge type: {edge_type}")

            return True
        except ValidationError as e:
            print(f"Validation error: {e.message}")
            return False
        except Exception as e:
            print(f"Unexpected error: {str(e)}")
            return False


if __name__ == "__main__":
    json_data = {
        "blocks": {
            "1": {
                "type": "text",
                "data": {
                    "content": "Hello, World!"
                }
            }
        },
        "edges": {
            "edge_1": {
                "type": "modify",
                "data": {
                    "modify_type": "deep_copy_string",
                    "inputs": {"1": ""},
                    "outputs": {"2": ""},
                    "content": "",
                    "looped": True
                }
            }
        },
        "version": "1.0"
    }

    validator = JsonValidator()
    is_valid = validator.validate(json_data)
    print(f"Is valid: {is_valid}")
