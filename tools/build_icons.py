#!/usr/bin/env python3
"""Builds public/vadivam-icons.js from the Vadivam icon set (MIT, https://github.com/praveenjuge/vadivam).
Usage: python3 tools/build_icons.py <vadivam checkout> <app: mintcode|beta> public/vadivam-icons.js
Each name below is the name this app uses -> the name of the Vadivam icon."""
import json, os, re, sys, xml.etree.ElementTree as ET
src, app, out = sys.argv[1], sys.argv[2], sys.argv[3]
MAP = {
  'mintcode': {'repo': 'book', 'folder': 'folder', 'file': 'file', 'star': 'star', 'branch': 'git-branch', 'history': 'rotate-ccw-clock', 'code': 'code', 'plus': 'plus', 'lock': 'lock', 'gear': 'settings', 'copy': 'copy', 'fork': 'git-fork', 'issue': 'circle-dot', 'tag': 'tag', 'comment': 'message-square'},
  'beta': {'comment': 'message-circle', 'repost': 'repeat-2', 'heart': 'heart', 'bookmark': 'bookmark', 'share': 'share', 'more': 'ellipsis', 'image': 'image', 'poll': 'chart-no-axes-column', 'file': 'file', 'bell': 'bell', 'x': 'x', 'pin': 'pin', 'rss': 'rss', 'mail': 'mail', 'explore': 'compass', 'list': 'list', 'smile': 'face-slightly-smiling', 'warn': 'circle-exclamation-point', 'forum': 'messages-square', 'users': 'users', 'gear': 'settings', 'lock': 'lock'},
}[app]
def parse(path):
    root = ET.parse(path).getroot()
    items = []
    for el in root.iter():
        tag = el.tag.split('}')[-1]
        if tag in ('svg', 'title', 'desc', 'defs'): continue
        items.append([tag, {k: v for k, v in el.attrib.items() if k not in ('class', 'style')}])
    return items
icons = {}
for mine, theirs in MAP.items():
    o = os.path.join(src, 'icons', theirs + '.svg')
    s = os.path.join(src, 'icons-solid', theirs + '.svg')
    if not os.path.exists(o): sys.exit('missing icon: ' + theirs)
    icons[mine] = {'o': parse(o)}
    if os.path.exists(s): icons[mine]['s'] = parse(s)
head = '/* Icons from Vadivam (https://github.com/praveenjuge/vadivam), MIT License, Copyright (c) Praveen Juge. See THIRD-PARTY.md. */\n'
open(out, 'w').write(head + 'window.__VADIVAM = ' + json.dumps(icons, separators=(',', ':')) + ';\n')
print(len(icons), 'icons,', os.path.getsize(out), 'bytes;', sum(1 for v in icons.values() if 's' in v), 'with a solid version')
