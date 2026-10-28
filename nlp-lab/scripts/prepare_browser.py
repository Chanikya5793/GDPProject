"""Package only source and English NLP resources; never the local user database."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED

root = Path(__file__).resolve().parents[1]
target = root / '.browser-build'
target.mkdir(exist_ok=True)
required = root / 'nltk_data' / 'corpora' / 'wordnet.zip'
tagger = root / 'nltk_data' / 'taggers' / 'averaged_perceptron_tagger_eng'
if not required.is_file() or not tagger.is_dir():
    raise SystemExit('Install English resources first: python -m nlplab.cli setup-nltk')
with ZipFile(target / 'source.zip', 'w', ZIP_DEFLATED) as archive:
    for path in sorted((root / 'nlplab').glob('*.py')):
        archive.write(path, path.relative_to(root).as_posix())
    archive.write(required, required.relative_to(root).as_posix())
    for path in sorted(tagger.glob('*.json')):
        archive.write(path, path.relative_to(root).as_posix())
print('Packaged source and English resources without local data')
