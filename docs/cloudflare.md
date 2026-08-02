# Cloudflare routing

## Redirect rules

| Order | Rule name | Match | Action |
| --- | --- | --- | --- |
| 1 | `Redirect /ombi requests` | URI Path starts with `/ombi` | `301` to `concat("https://ombi.crapshack.net", substring(http.request.uri.path, 5))` |
| 2 | `Redirect from /privacy.html` | `http.request.uri.path eq "/privacy.html"` | `301` to `https://crapshack.net/privacy` |
| 3 | `spotuify shell installer` | `http.host eq "crapshack.net" and http.request.uri.path eq "/spotuify/install.sh"` | `302` to `https://github.com/austin-smith/spotuify/releases/latest/download/install.sh` |
| 4 | `spotuify powershell installer` | `http.host eq "crapshack.net" and http.request.uri.path eq "/spotuify/install.ps1"` | `302` to `https://github.com/austin-smith/spotuify/releases/latest/download/install.ps1` |
