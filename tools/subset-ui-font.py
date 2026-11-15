"""Create the renamed OFL UI font subset. Requires fonttools[woff] and brotli.

Input is the unmodified official Source Han Serif CN Regular OTF. It is not
committed with the website. This subset affects interface type only; animated
characters continue to use the separately licensed stroke SVGs.
"""
from pathlib import Path
import argparse, hashlib, json
from fontTools import subset
from fontTools.ttLib import TTFont

parser=argparse.ArgumentParser()
parser.add_argument('font',type=Path)
parser.add_argument('license',type=Path)
args=parser.parse_args()
root=Path(__file__).resolve().parents[1]
text=''.join((root/name).read_text(encoding='utf-8') for name in ['index.html','app.js','model.js','store.js','ai.js'])
text+=''.join(chr(i) for i in range(32,127))+'墨习一字一法简体繁體汉字漢字查字我的知识库数据管理导入导出左右上下内外中独体结构偏旁部首笔画順序动画'
font=TTFont(args.font)
options=subset.Options()
options.name_IDs=['*']
options.name_legacy=True
options.name_languages=['*']
subsetter=subset.Subsetter(options=options)
subsetter.populate(text=text)
subsetter.subset(font)
names={1:'Moxi Book Serif',2:'Regular',3:'MoxiBookSerif-Regular-20261115',4:'Moxi Book Serif Regular',6:'MoxiBookSerif-Regular',16:'Moxi Book Serif',17:'Regular'}
for record in font['name'].names:
    if record.nameID in names:
        record.string=names[record.nameID].encode(record.getEncoding(),errors='replace')
if 'CFF ' in font:
    cff=font['CFF '].cff
    cff.fontNames=['MoxiBookSerif-Regular']
    for top in cff.topDictIndex:
        top.FamilyName='Moxi Book Serif'
        top.FullName='Moxi Book Serif Regular'
font.flavor='woff2'
out=root/'vendor/fonts/moxi-book-serif.woff2'
out.parent.mkdir(parents=True,exist_ok=True)
font.save(out)
license_output=root/'licenses/Moxi-Book-Serif-OFL.txt'
license_output.write_text('Moxi Book Serif UI subset\nDerived from Adobe Source Han Serif CN Regular.\nModified 2026-11-15: selected interface characters, converted to WOFF2, and renamed.\nThis is an interface font, not a calligrapher\'s handwriting.\n\n'+args.license.read_text(encoding='utf-8'),encoding='utf-8')
print(json.dumps({'bytes':out.stat().st_size,'characters':len(set(text)),'sourceSha256':hashlib.sha256(args.font.read_bytes()).hexdigest(),'outputSha256':hashlib.sha256(out.read_bytes()).hexdigest()}))
