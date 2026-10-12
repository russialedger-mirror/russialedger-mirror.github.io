# Зеркало RussiaLedger.com · Mirror of RussiaLedger.com

**Русский.** Это зеркало сайта «Бюджет России: открытый отчёт» (RussiaLedger.com) на GitHub Pages: https://russialedger-mirror.github.io/

Раз в час GitHub Actions скачивает подписанную версию сайта, проверяет подпись и каждый файл (`pull.mjs`) и публикует копию. Если подпись не сходится, зеркало продолжает показывать последнюю проверенную версию. Изменить сайт на зеркале нельзя.

Как проверить копию: `release.json` перечисляет каждый файл с его контрольной суммой (sha256), `release.json.minisig` — подпись этого списка.

    minisign -Vm release.json -P RWRvGOpGgdZw4fGudqOt1aLEPZdd0IxZL7jdScxLzJ4G5YnWJqAmq0Jc

Все адреса сайта и как запустить своё зеркало: https://russialedger.com/mirrors/

**English.** A mirror of RussiaLedger.com on GitHub Pages: https://russialedger-mirror.github.io/

Every hour GitHub Actions downloads the signed release of the site, checks the signature and every file (`pull.mjs`), and publishes the copy. If the signature does not match, the mirror keeps serving the last release that did. A mirror cannot change the site.

To check a copy: `release.json` lists every file with its checksum (sha256), and `release.json.minisig` is the signature of that list (the command above).

Every address of the site, and how to run a mirror of your own: https://russialedger.com/en/mirrors/
