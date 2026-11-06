function Get-IdentityPayloadFiles([string]$Source,[switch]$PanelUpdate) {
    $manifest=Get-Content -LiteralPath (Join-Path $Source 'payload-files.json') -Raw -Encoding UTF8|ConvertFrom-Json
    if($manifest.version -ne 1 -or !$manifest.files.Count){throw 'Unsupported payload file manifest'}
    $seen=New-Object 'System.Collections.Generic.HashSet[string]' ([StringComparer]::OrdinalIgnoreCase)
    foreach($entry in $manifest.files){
        if($entry.path -notmatch '^(?:public/)?[A-Za-z0-9_-][A-Za-z0-9_.-]*$' -or $entry.panelUpdate -isnot [bool]){throw 'Invalid payload manifest entry'}
        if(!$seen.Add($entry.path)){throw ('Duplicate payload file: '+$entry.path)}
        if($PanelUpdate -and !$entry.panelUpdate){continue}
        if(!(Test-Path -LiteralPath (Join-Path $Source $entry.path) -PathType Leaf)){throw ('Missing payload file: '+$entry.path)}
        $entry.path
    }
}
