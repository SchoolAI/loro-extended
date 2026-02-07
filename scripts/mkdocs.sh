#!/usr/bin/env bash

(find packages -name "README.md" && find docs -name '*.md') | xargs cat
