#!/bin/sh
cd /home/hv/projs/PuppyAgent-Jack/PuppyFlow
npx vitest run __tests__/text-block-node/unit/TextBlockNode.content.test.tsx --reporter=verbose 2>&1

