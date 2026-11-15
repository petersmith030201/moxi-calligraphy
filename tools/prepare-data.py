"""Prepare the bundled Make Me a Hanzi snapshot without network access.

Usage: python tools/prepare-data.py --source ../../work/external-data
The default source resolves to the task workspace's work/external-data directory.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_SOURCE = ROOT.parents[1] / "work" / "external-data"
STRUCTURES = {
    "⿰": "左右结构", "⿱": "上下结构", "⿲": "左中右结构", "⿳": "上中下结构",
    "⿴": "全包围结构", "⿵": "半包围结构", "⿶": "半包围结构", "⿷": "半包围结构",
    "⿸": "半包围结构", "⿹": "半包围结构", "⿺": "半包围结构", "⿻": "交叠结构",
}
LICENSES = ["LGPL-3.0-or-later（字典）", "Arphic Public License（图形）"]
COMMON_INDEPENDENT = set("永天大木水火人一二三十上下口日月田目山川中土工小")
TOKEN = re.compile(r"[MLQCZ]|[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][-+]?\d+)?")
ARITY = {"M": 2, "L": 2, "Q": 4, "C": 6, "Z": 0}


def read_records(path: Path) -> dict:
    records = {}
    for line_number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        if not line.strip():
            continue
        record = json.loads(line)
        character = record.get("character")
        if not isinstance(character, str) or len(character) != 1 or character in records:
            raise ValueError(f"{path.name}:{line_number}: invalid or duplicate character")
        if character in '/\\:*?"<>|' or ord(character) < 32:
            raise ValueError("Unsafe output filename")
        records[character] = record
    return records


def validate_path(path: str) -> bool:
    if not isinstance(path, str) or not path or len(path) > 30000:
        return False
    tokens = TOKEN.findall(path)
    if re.sub(TOKEN, "", path).strip(" ,\t\r\n") or not tokens or tokens[0] != "M":
        return False
    index = 0
    while index < len(tokens):
        command = tokens[index]
        if command not in ARITY:
            return False
        index += 1
        count = ARITY[command]
        if index + count > len(tokens):
            return False
        for value in tokens[index:index + count]:
            try:
                number = float(value)
            except ValueError:
                return False
            if not math.isfinite(number) or abs(number) > 100000:
                return False
        index += count
    return tokens[-1] == "Z"


def validate_graphic(record: dict) -> bool:
    paths, medians = record.get("strokes"), record.get("medians")
    if not isinstance(paths, list) or not isinstance(medians, list) or not 1 <= len(paths) <= 100:
        return False
    if len(paths) != len(medians) or not all(validate_path(path) for path in paths):
        return False
    for median in medians:
        if not isinstance(median, list) or not 2 <= len(median) <= 1000:
            return False
        for point in median:
            if not isinstance(point, list) or len(point) != 2:
                return False
            if any(isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v) or abs(v) > 100000 for v in point):
                return False
    return True


def write_json(path: Path, value, pretty=False):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2 if pretty else None,
                               separators=None if pretty else (",", ":")) + "\n", encoding="utf-8")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", type=Path, default=DEFAULT_SOURCE)
    args = parser.parse_args()
    source = args.source.resolve()
    dictionary = read_records(source / "dictionary.txt")
    graphics = read_records(source / "graphics.txt")
    metadata, rejected = {}, []
    stroke_total = 0
    for character, graphic in graphics.items():
        if character not in dictionary or not validate_graphic(graphic):
            rejected.append(character)
            continue
        record = dictionary[character]
        decomposition = record.get("decomposition") or "？"
        reference_correction = character in COMMON_INDEPENDENT
        uncertain_ids = "？" in decomposition or "?" in decomposition or decomposition.startswith("⿻")
        teaching_structure = "独体字" if reference_correction else (
            "结构待核对" if uncertain_ids else STRUCTURES.get(decomposition[:1], "结构待核对"))
        metadata[character] = {
            "strokesCount": len(graphic["strokes"]),
            "radical": record.get("radical") or "",
            "decomposition": decomposition,
            "structure": teaching_structure,
            "structureSource": "本站整理的常见独体字参考校正（可修订）" if reference_correction else "Make Me a Hanzi IDS拓扑参考（非书法结构规范）",
            "reviewNotes": "保留上游原始IDS；结构仅作可修订参考，不声称全面符合各地域规范。" + (
                "含未知拆分，不将其直接当作教学结构。" if uncertain_ids else ""),
            "source": "Make Me a Hanzi",
            "sourceUrl": "https://github.com/skishore/makemeahanzi",
            "reviewed": False,
            "glyphLabel": "开源笔顺参考字形；可能有地域或版本差异，不是教材作者真迹",
            "licenses": LICENSES,
        }
        write_json(ROOT / "data" / "characters" / f"{character}.json", {
            "character": character, "strokes": graphic["strokes"], "medians": graphic["medians"],
        })
        stroke_total += len(graphic["strokes"])
    write_json(ROOT / "data" / "characters.json", metadata)
    resources = []
    for filename in ["dictionary.txt", "graphics.txt", "hanzi-writer-3.7.3.tgz"]:
        path = source / filename
        if path.exists():
            resources.append({"file": filename, "sha256": hashlib.sha256(path.read_bytes()).hexdigest()})
    write_json(ROOT / "data" / "source-manifest.json", {
        "schemaVersion": 1,
        "dataset": "Make Me a Hanzi",
        "sourceUrl": "https://github.com/skishore/makemeahanzi",
        "retrievedAt": "2026-11-15",
        "resources": resources,
        "metadataCount": len(metadata),
        "strokeCount": len(metadata),
        "strokeTotal": stroke_total,
        "rejectedCharacters": rejected,
        "licenses": LICENSES,
        "coverageNote": "覆盖本次上游快照中通过笔画路径和轨迹校验的字形，包含简体、繁体及部分部件；不代表覆盖所有汉字。缺字不以另一简繁或地域字形替代。",
        "glyphCaveat": "数据未提供大陆、台湾、香港标准字形的逐项选择，笔顺与字形可能存在地域或版本差异；IDS和部首均为开源参考，可由用户修订，未知拆分不推定为独体字。",
        "structureCorrections": {"characters": sorted(COMMON_INDEPENDENT), "structure": "独体字", "source": "本站整理的24字可审阅参考校正；不是全面规范认证，允许用户修订。"},
        "aliasesNote": "个人备份中的aliases是保留的扩展字段，当前不参与匹配；不默认合并水与氵、手与扌，简繁按实际字符分别查询。",
    }, pretty=True)
    print(json.dumps({"dictionary": len(dictionary), "graphics": len(graphics), "accepted": len(metadata),
                      "rejected": len(rejected), "total_strokes": stroke_total}, ensure_ascii=True))


if __name__ == "__main__":
    main()
