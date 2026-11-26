# CI only: plays the user's part in VB-Audio's installer (clicks "Install Driver", then OK on its dialogs).
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
$A = [System.Windows.Automation.AutomationElement]
$deadline = (Get-Date).AddMinutes(30)
$dumped = @{}
while ((Get-Date) -lt $deadline) {
  $wins = $A::RootElement.FindAll([System.Windows.Automation.TreeScope]::Children, [System.Windows.Automation.Condition]::TrueCondition)
  foreach ($w in $wins) {
    try { $p = Get-Process -Id $w.Current.ProcessId -ErrorAction Stop } catch { continue }
    if ($p.ProcessName -notmatch 'VBCABLE') { continue }
    $all = $w.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
    $key = "$($w.Current.Name)|$($all.Count)"
    if (-not $dumped[$key]) {
      $dumped[$key] = $true
      Write-Host "[clicker] window '$($w.Current.Name)' ($($p.ProcessName)) elements:"
      foreach ($e in $all) { Write-Host "   - $($e.Current.ControlType.ProgrammaticName) '$($e.Current.Name)'" }
    }
    foreach ($e in $all) {
      if ($e.Current.ControlType -ne [System.Windows.Automation.ControlType]::Button) { continue }
      if ($e.Current.Name -match '^(Install Driver|OK|Yes|Install)$') {
        Write-Host "[clicker] clicking '$($e.Current.Name)'"
        try { $e.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke() } catch { Write-Host "[clicker] invoke failed: $_" }
        Start-Sleep 2
      }
    }
  }
  Start-Sleep 1
}
