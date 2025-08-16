# If you are a VS Code users:
import os
import sys
sys.path.append(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

import os
from ModularEdges.LoadEdge.base_load import LoadStrategy
from Utils.puppy_exception import global_exception_handler, PuppyException
from Utils.file_type import decide_file_type
from ModularEdges.LoadEdge.load_from_file import FileToTextParser
from Utils.logger import log_warning


class FileLoadStrategy(LoadStrategy):
    @global_exception_handler(1003, "Unexpected Error in Loading File")
    def load(
        self
    ) -> str:
        self.validate_content()

        # The definitive source of files should be the resolved content of the input block,
        # which contains local paths after prefetching. We ignore extra_configs.file_configs
        # from the original request as it contains unresolved storage keys.
        content = self.content

        derived_files = None
        # Case 1: content is already a list of file entries from prefetch
        if isinstance(content, list) and all(isinstance(f, dict) for f in content):
            if any('local_path' in f for f in content):
                derived_files = content
        # Case 2: content is a dict wrapper { type: 'files', files: [...] }
        elif isinstance(content, dict) and content.get('type') == 'files':
            derived_files = content.get('files', [])

        if not derived_files:
            raise PuppyException(
                1300, 
                "No files with local_path found in the input block content. The prefetch step might have failed."
            )

        default_parse_config = self.extra_configs.get('default_parse_config', {})
        file_configs = []
        for f in derived_files:
            local_path = f.get('local_path') or f.get('path')
            if not local_path:
                # skip entries without valid local path (e.g. failed downloads)
                log_warning(f"Skipping file because local_path is missing: {f.get('file_name')}")
                continue
            file_configs.append({
                'file_path': local_path,
                'file_type': decide_file_type(
                    f.get('file_type'),
                    f.get('mime_type'),
                    local_path
                ),
                'config': default_parse_config
            })
        
        if not file_configs:
            raise PuppyException(1300, "No valid files could be prepared for parsing.")

        return FileToTextParser().parse_multiple(file_configs)
