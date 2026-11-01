param([Parameter(Mandatory=$true)][string]$InputDocx,[Parameter(Mandatory=$true)][string]$OutputPdf)
$ErrorActionPreference='Stop'
$wordApp=$null
$workingDoc=$null
try {
  $wordApp=New-Object -ComObject Word.Application
  $wordApp.Visible=$false
  $wordApp.DisplayAlerts=0
  $wordApp.AutomationSecurity=3
  $workingDoc=$wordApp.Documents.Open($InputDocx,$false,$true,$false)
  $workingDoc.Repaginate()
  $workingDoc.ExportAsFixedFormat($OutputPdf,17)
  Write-Output ('Rendered pages: '+$workingDoc.ComputeStatistics(2))
} finally {
  if($workingDoc){$workingDoc.Close(0)}
  if($wordApp){$wordApp.Quit()}
}
