# Core

The core turns the canonical CodeMirror source into semantic elements and
typed render plans, then adapts those plans to editor decorations and generic
commands. It owns only leaf Feature contracts and the injected composition
facet; it does not import concrete feature models, plan compilers, definitions,
or widgets. Missing composition capability degrades to visible source rather
than guessing or silently reparsing a feature.
