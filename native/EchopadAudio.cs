// EchopadAudio.exe — small Windows helper used by Echopad.
// Talks to the Windows Core Audio APIs so Echopad can configure itself automatically.
//
//   EchopadAudio status                 JSON: endpoints, defaults, capture sessions, mic privacy
//   EchopadAudio set-default <id>       make endpoint the default for all roles
//   EchopadAudio enable <id>            re-enable a disabled endpoint
//   EchopadAudio fix-mic-privacy        allow desktop apps to use the microphone (current user)
//   EchopadAudio verify <file>          JSON: Authenticode trust + signer
//   EchopadAudio run-installer <zip>    extract the official VB-CABLE pack, verify it, run its setup elevated
//
// Every command prints exactly one JSON object on stdout. Compiles with csc (.NET Framework 4.x) or mcs.

using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Diagnostics;
using System.IO;
using System.IO.Compression;
using System.Management;
using System.Runtime.InteropServices;
using System.Security.Cryptography.X509Certificates;
using System.Text;
using Microsoft.Win32;

namespace Echopad
{
    enum EDataFlow { Render = 0, Capture = 1, All = 2 }
    enum ERole { Console = 0, Multimedia = 1, Communications = 2 }

    [StructLayout(LayoutKind.Sequential)]
    struct PropertyKey
    {
        public Guid fmtid;
        public int pid;
        public PropertyKey(Guid f, int p) { fmtid = f; pid = p; }
    }

    [StructLayout(LayoutKind.Explicit, Size = 24)]
    struct PropVariant
    {
        [FieldOffset(0)] public short vt;
        [FieldOffset(8)] public IntPtr pointerValue;
    }

    [ComImport, Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IMMDeviceEnumerator
    {
        [PreserveSig] int EnumAudioEndpoints(EDataFlow dataFlow, int stateMask, out IMMDeviceCollection devices);
        [PreserveSig] int GetDefaultAudioEndpoint(EDataFlow dataFlow, ERole role, out IMMDevice device);
        [PreserveSig] int GetDevice([MarshalAs(UnmanagedType.LPWStr)] string id, out IMMDevice device);
        [PreserveSig] int RegisterEndpointNotificationCallback(IntPtr client);
        [PreserveSig] int UnregisterEndpointNotificationCallback(IntPtr client);
    }

    [ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")]
    class MMDeviceEnumeratorComObject { }

    [ComImport, Guid("0BD7A1BE-7A1A-44DB-8397-CC5392387B5E"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IMMDeviceCollection
    {
        [PreserveSig] int GetCount(out int count);
        [PreserveSig] int Item(int index, out IMMDevice device);
    }

    [ComImport, Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IMMDevice
    {
        [PreserveSig] int Activate(ref Guid iid, int clsCtx, IntPtr activationParams, [MarshalAs(UnmanagedType.IUnknown)] out object iface);
        [PreserveSig] int OpenPropertyStore(int stgmAccess, out IPropertyStore properties);
        [PreserveSig] int GetId([MarshalAs(UnmanagedType.LPWStr)] out string id);
        [PreserveSig] int GetState(out int state);
    }

    [ComImport, Guid("886d8eeb-8cf2-4446-8d02-cdba1dbdcf99"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IPropertyStore
    {
        [PreserveSig] int GetCount(out int count);
        [PreserveSig] int GetAt(int index, out PropertyKey key);
        [PreserveSig] int GetValue(ref PropertyKey key, out PropVariant value);
        [PreserveSig] int SetValue(ref PropertyKey key, ref PropVariant value);
        [PreserveSig] int Commit();
    }

    // Undocumented but stable since Windows 7; used by the Windows Sound control panel itself.
    [ComImport, Guid("f8679f50-850a-41cf-9c72-430f290290c8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IPolicyConfig
    {
        [PreserveSig] int GetMixFormat(IntPtr id, IntPtr format);
        [PreserveSig] int GetDeviceFormat(IntPtr id, int useDefault, IntPtr format);
        [PreserveSig] int ResetDeviceFormat(IntPtr id);
        [PreserveSig] int SetDeviceFormat(IntPtr id, IntPtr endpointFormat, IntPtr mixFormat);
        [PreserveSig] int GetProcessingPeriod(IntPtr id, int useDefault, IntPtr defaultPeriod, IntPtr minimumPeriod);
        [PreserveSig] int SetProcessingPeriod(IntPtr id, IntPtr period);
        [PreserveSig] int GetShareMode(IntPtr id, IntPtr mode);
        [PreserveSig] int SetShareMode(IntPtr id, IntPtr mode);
        [PreserveSig] int GetPropertyValue(IntPtr id, int fxStore, IntPtr key, IntPtr value);
        [PreserveSig] int SetPropertyValue(IntPtr id, int fxStore, IntPtr key, IntPtr value);
        [PreserveSig] int SetDefaultEndpoint([MarshalAs(UnmanagedType.LPWStr)] string id, ERole role);
        [PreserveSig] int SetEndpointVisibility([MarshalAs(UnmanagedType.LPWStr)] string id, int visible);
    }

    [ComImport, Guid("870af99c-171d-4f9e-af0d-e63df40c2bc9")]
    class PolicyConfigComObject { }

    [ComImport, Guid("77AA99A0-1BD6-484F-8BC7-2C654C9A9B6F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IAudioSessionManager2
    {
        [PreserveSig] int GetAudioSessionControl(IntPtr sessionGuid, int flags, out IntPtr control);
        [PreserveSig] int GetSimpleAudioVolume(IntPtr sessionGuid, int flags, out IntPtr volume);
        [PreserveSig] int GetSessionEnumerator(out IAudioSessionEnumerator sessions);
        [PreserveSig] int RegisterSessionNotification(IntPtr notification);
        [PreserveSig] int UnregisterSessionNotification(IntPtr notification);
        [PreserveSig] int RegisterDuckNotification(IntPtr sessionId, IntPtr notification);
        [PreserveSig] int UnregisterDuckNotification(IntPtr notification);
    }

    [ComImport, Guid("E2F5BB11-0570-40CA-ACDD-3AA01277DEE8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IAudioSessionEnumerator
    {
        [PreserveSig] int GetCount(out int count);
        [PreserveSig] int GetSession(int index, out IAudioSessionControl2 session);
    }

    [ComImport, Guid("bfb7ff88-7239-4fc9-8fa2-07c950be9c6d"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IAudioSessionControl2
    {
        [PreserveSig] int GetState(out int state);
        [PreserveSig] int GetDisplayName(out IntPtr name);
        [PreserveSig] int SetDisplayName(IntPtr value, IntPtr eventContext);
        [PreserveSig] int GetIconPath(out IntPtr path);
        [PreserveSig] int SetIconPath(IntPtr value, IntPtr eventContext);
        [PreserveSig] int GetGroupingParam(out Guid groupingParam);
        [PreserveSig] int SetGroupingParam(IntPtr groupingParam, IntPtr eventContext);
        [PreserveSig] int RegisterAudioSessionNotification(IntPtr notification);
        [PreserveSig] int UnregisterAudioSessionNotification(IntPtr notification);
        [PreserveSig] int GetSessionIdentifier(out IntPtr id);
        [PreserveSig] int GetSessionInstanceIdentifier(out IntPtr id);
        [PreserveSig] int GetProcessId(out int pid);
        [PreserveSig] int IsSystemSoundsSession();
        [PreserveSig] int SetDuckingPreference(int optOut);
    }

    class Endpoint
    {
        public string Id;
        public string Name;
        public int State;
        public bool[] Defaults = new bool[3];
    }

    static class Program
    {
        const int DEVICE_STATE_ACTIVE = 1, DEVICE_STATE_DISABLED = 2, DEVICE_STATE_NOTPRESENT = 4, DEVICE_STATE_UNPLUGGED = 8;
        const int CLSCTX_ALL = 23;
        static readonly PropertyKey PKEY_Device_FriendlyName =
            new PropertyKey(new Guid("a45c254e-df1c-4efd-8020-67d146a850e0"), 14);
        static readonly Guid IID_IAudioSessionManager2 = new Guid("77AA99A0-1BD6-484F-8BC7-2C654C9A9B6F");

        [DllImport("ole32.dll")] static extern int PropVariantClear(ref PropVariant pvar);

        [STAThread]
        static int Main(string[] args)
        {
            Console.OutputEncoding = new UTF8Encoding(false);
            try
            {
                string cmd = args.Length > 0 ? args[0] : "status";
                switch (cmd)
                {
                    case "status": Console.WriteLine(Status()); return 0;
                    case "set-default": Console.WriteLine(SetDefault(Arg(args, 1))); return 0;
                    case "enable": Console.WriteLine(Enable(Arg(args, 1))); return 0;
                    case "fix-mic-privacy": Console.WriteLine(FixMicPrivacy()); return 0;
                    case "verify": Console.WriteLine(Verify(Arg(args, 1))); return 0;
                    case "run-installer": Console.WriteLine(RunInstaller(Arg(args, 1))); return 0;
                    case "enable-pnp": Console.WriteLine(EnablePnp(Arg(args, 1))); return 0;
                    case "selftest": Console.WriteLine("{\"ok\":true,\"selftest\":true}"); return 0;
                    default: Console.WriteLine(Error("unknown command " + cmd)); return 2;
                }
            }
            catch (Exception ex)
            {
                Console.WriteLine(Error(ex.GetType().Name + ": " + ex.Message));
                return 1;
            }
        }

        static string Arg(string[] a, int i)
        {
            if (a.Length <= i) throw new ArgumentException("missing argument");
            return a[i];
        }

        // ------------------------------------------------------------------ endpoints
        static IMMDeviceEnumerator NewEnumerator()
        {
            return (IMMDeviceEnumerator)new MMDeviceEnumeratorComObject();
        }

        static string FriendlyName(IMMDevice dev)
        {
            IPropertyStore store;
            if (dev.OpenPropertyStore(0, out store) != 0 || store == null) return "";
            PropertyKey key = PKEY_Device_FriendlyName;
            PropVariant pv;
            if (store.GetValue(ref key, out pv) != 0) return "";
            string name = pv.vt == 31 ? Marshal.PtrToStringUni(pv.pointerValue) : "";
            PropVariantClear(ref pv);
            return name ?? "";
        }

        static string DefaultId(IMMDeviceEnumerator en, EDataFlow flow, ERole role)
        {
            IMMDevice dev;
            if (en.GetDefaultAudioEndpoint(flow, role, out dev) != 0 || dev == null) return null;
            string id;
            dev.GetId(out id);
            return id;
        }

        static List<Endpoint> ListEndpoints(IMMDeviceEnumerator en, EDataFlow flow)
        {
            var list = new List<Endpoint>();
            IMMDeviceCollection col;
            int mask = DEVICE_STATE_ACTIVE | DEVICE_STATE_DISABLED | DEVICE_STATE_NOTPRESENT | DEVICE_STATE_UNPLUGGED;
            if (en.EnumAudioEndpoints(flow, mask, out col) != 0 || col == null) return list;
            int count;
            col.GetCount(out count);
            string[] defaults = {
                DefaultId(en, flow, ERole.Console),
                DefaultId(en, flow, ERole.Multimedia),
                DefaultId(en, flow, ERole.Communications)
            };
            for (int i = 0; i < count; i++)
            {
                IMMDevice dev;
                if (col.Item(i, out dev) != 0 || dev == null) continue;
                var ep = new Endpoint();
                dev.GetId(out ep.Id);
                dev.GetState(out ep.State);
                ep.Name = FriendlyName(dev);
                for (int r = 0; r < 3; r++) ep.Defaults[r] = ep.Id == defaults[r];
                list.Add(ep);
            }
            return list;
        }

        // ------------------------------------------------------------------ sessions
        static void AppendSessions(StringBuilder sb, IMMDeviceEnumerator en, List<Endpoint> captures, ref bool first)
        {
            foreach (var ep in captures)
            {
                if (ep.State != DEVICE_STATE_ACTIVE) continue;
                IMMDevice dev;
                if (en.GetDevice(ep.Id, out dev) != 0 || dev == null) continue;
                object o;
                Guid iid = IID_IAudioSessionManager2;
                if (dev.Activate(ref iid, CLSCTX_ALL, IntPtr.Zero, out o) != 0 || o == null) continue;
                var mgr = (IAudioSessionManager2)o;
                IAudioSessionEnumerator sessions;
                if (mgr.GetSessionEnumerator(out sessions) != 0 || sessions == null) continue;
                int n;
                sessions.GetCount(out n);
                for (int i = 0; i < n; i++)
                {
                    IAudioSessionControl2 s;
                    if (sessions.GetSession(i, out s) != 0 || s == null) continue;
                    int pid, state;
                    s.GetProcessId(out pid);
                    s.GetState(out state);
                    if (pid == 0 || state == 2) continue; // system / expired
                    string proc = "";
                    try { proc = Process.GetProcessById(pid).ProcessName; } catch { }
                    if (!first) sb.Append(',');
                    first = false;
                    sb.Append("{\"deviceId\":").Append(J(ep.Id))
                      .Append(",\"deviceName\":").Append(J(ep.Name))
                      .Append(",\"pid\":").Append(pid)
                      .Append(",\"process\":").Append(J(proc))
                      .Append(",\"active\":").Append(state == 1 ? "true" : "false").Append('}');
                }
            }
        }

        // ------------------------------------------------------------------ commands
        static string Status()
        {
            var en = NewEnumerator();
            var render = ListEndpoints(en, EDataFlow.Render);
            var capture = ListEndpoints(en, EDataFlow.Capture);
            var sb = new StringBuilder();
            sb.Append("{\"ok\":true,\"render\":").Append(EndpointsJson(render))
              .Append(",\"capture\":").Append(EndpointsJson(capture))
              .Append(",\"sessions\":[");
            bool first = true;
            try { AppendSessions(sb, en, capture, ref first); } catch { }
            sb.Append("],\"micPrivacy\":").Append(MicPrivacyJson())
              .Append(",\"driverService\":").Append(DriverServiceInstalled() ? "true" : "false")
              .Append(",\"driverFile\":").Append(DriverFileExists() ? "true" : "false")
              .Append(",\"pnp\":").Append(PnpJson())
              .Append(",\"os\":").Append(J(Environment.OSVersion.VersionString)).Append('}');
            return sb.ToString();
        }

        static string EndpointsJson(List<Endpoint> list)
        {
            var sb = new StringBuilder("[");
            for (int i = 0; i < list.Count; i++)
            {
                var e = list[i];
                if (i > 0) sb.Append(',');
                sb.Append("{\"id\":").Append(J(e.Id))
                  .Append(",\"name\":").Append(J(e.Name))
                  .Append(",\"state\":").Append(e.State)
                  .Append(",\"defaults\":[")
                  .Append(e.Defaults[0] ? "true" : "false").Append(',')
                  .Append(e.Defaults[1] ? "true" : "false").Append(',')
                  .Append(e.Defaults[2] ? "true" : "false").Append("]}");
            }
            return sb.Append(']').ToString();
        }

        static string SetDefault(string id)
        {
            var policy = (IPolicyConfig)new PolicyConfigComObject();
            int[] hr = new int[3];
            for (int r = 0; r < 3; r++) hr[r] = policy.SetDefaultEndpoint(id, (ERole)r);
            bool ok = hr[0] == 0 && hr[1] == 0 && hr[2] == 0;
            return "{\"ok\":" + (ok ? "true" : "false") + ",\"hr\":[" + hr[0] + "," + hr[1] + "," + hr[2] + "]}";
        }

        static string Enable(string id)
        {
            var policy = (IPolicyConfig)new PolicyConfigComObject();
            int hr = policy.SetEndpointVisibility(id, 1);
            return "{\"ok\":" + (hr == 0 ? "true" : "false") + ",\"hr\":" + hr + "}";
        }

        // VB-CABLE's kernel driver registers this service (see vbMmeCable64_win10.inf: ServiceName="VBAudioVACMME").
        // It exists as soon as the driver is installed, even before the reboot that creates the audio devices.
        static bool DriverServiceInstalled()
        {
            try
            {
                using (var services = Registry.LocalMachine.OpenSubKey(@"SYSTEM\CurrentControlSet\Services"))
                {
                    if (services == null) return false;
                    foreach (var name in services.GetSubKeyNames())
                        if (name.StartsWith("VBAudioVAC", StringComparison.OrdinalIgnoreCase)) return true;
                }
            }
            catch { }
            return false;
        }

        static bool DriverFileExists()
        {
            string drivers = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Windows), "System32", "drivers");
            try { return Directory.GetFiles(drivers, "vbaudio_cable*.sys").Length > 0; } catch { return false; }
        }

        // The VB-CABLE device node as Device Manager sees it: present? error code (22 = disabled, 52 = signature, ...)
        static string PnpJson()
        {
            var sb = new StringBuilder("[");
            bool first = true;
            try
            {
                string q = "SELECT Name, PNPDeviceID, Status, ConfigManagerErrorCode, Manufacturer FROM Win32_PnPEntity " +
                           "WHERE PNPDeviceID LIKE '%VBAUDIOVAC%' OR Name LIKE '%VB-Audio%' OR Manufacturer LIKE '%VB-Audio%' " +
                           "OR PNPDeviceID LIKE 'ROOT\\\\MEDIA\\\\%'";
                using (var searcher = new ManagementObjectSearcher(q))
                {
                    searcher.Options.Timeout = TimeSpan.FromSeconds(8);
                    foreach (ManagementObject mo in searcher.Get())
                    {
                        if (!first) sb.Append(',');
                        first = false;
                        object code = mo["ConfigManagerErrorCode"];
                        sb.Append("{\"name\":").Append(J(Convert.ToString(mo["Name"])))
                          .Append(",\"id\":").Append(J(Convert.ToString(mo["PNPDeviceID"])))
                          .Append(",\"status\":").Append(J(Convert.ToString(mo["Status"])))
                          .Append(",\"manufacturer\":").Append(J(Convert.ToString(mo["Manufacturer"])))
                          .Append(",\"error\":").Append(code == null ? "0" : Convert.ToString(Convert.ToUInt32(code))).Append('}');
                    }
                }
            }
            catch (Exception ex)
            {
                if (!first) sb.Append(',');
                sb.Append("{\"queryError\":").Append(J(ex.Message)).Append('}');
            }
            return sb.Append(']').ToString();
        }

        // Re-enable a device that is disabled in Device Manager (needs administrator; Windows asks for approval).
        static string EnablePnp(string instanceId)
        {
            string pnputil = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System), "pnputil.exe");
            var psi = new ProcessStartInfo(pnputil, "/enable-device \"" + instanceId + "\"")
            {
                UseShellExecute = true,
                Verb = "runas",
                WindowStyle = ProcessWindowStyle.Hidden
            };
            try
            {
                using (var p = Process.Start(psi))
                {
                    p.WaitForExit();
                    return "{\"ok\":" + (p.ExitCode == 0 ? "true" : "false") + ",\"exitCode\":" + p.ExitCode + "}";
                }
            }
            catch (Win32Exception ex)
            {
                if (ex.NativeErrorCode == 1223) return "{\"ok\":false,\"error\":\"cancelled\"}";
                return Error(ex.Message);
            }
        }

        // ------------------------------------------------------------------ microphone privacy
        const string ConsentKey = @"Software\Microsoft\Windows\CurrentVersion\CapabilityAccessManager\ConsentStore\microphone";

        static string ReadConsent(RegistryKey root, string sub)
        {
            try
            {
                using (var k = root.OpenSubKey(sub))
                {
                    if (k == null) return "";
                    var v = k.GetValue("Value") as string;
                    return v ?? "";
                }
            }
            catch { return ""; }
        }

        static string MicPrivacyJson()
        {
            return "{\"user\":" + J(ReadConsent(Registry.CurrentUser, ConsentKey)) +
                   ",\"desktop\":" + J(ReadConsent(Registry.CurrentUser, ConsentKey + @"\NonPackaged")) +
                   ",\"machine\":" + J(ReadConsent(Registry.LocalMachine, ConsentKey)) + "}";
        }

        static string FixMicPrivacy()
        {
            using (var k = Registry.CurrentUser.CreateSubKey(ConsentKey)) k.SetValue("Value", "Allow", RegistryValueKind.String);
            using (var k = Registry.CurrentUser.CreateSubKey(ConsentKey + @"\NonPackaged")) k.SetValue("Value", "Allow", RegistryValueKind.String);
            return "{\"ok\":true,\"micPrivacy\":" + MicPrivacyJson() + "}";
        }

        // ------------------------------------------------------------------ signature verification
        [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
        class WinTrustFileInfo
        {
            public int cbStruct = Marshal.SizeOf(typeof(WinTrustFileInfo));
            public IntPtr pcwszFilePath;
            public IntPtr hFile = IntPtr.Zero;
            public IntPtr pgKnownSubject = IntPtr.Zero;
        }

        [StructLayout(LayoutKind.Sequential)]
        class WinTrustData
        {
            public int cbStruct = Marshal.SizeOf(typeof(WinTrustData));
            public IntPtr pPolicyCallbackData = IntPtr.Zero;
            public IntPtr pSIPClientData = IntPtr.Zero;
            public int dwUIChoice = 2;           // WTD_UI_NONE
            public int fdwRevocationChecks = 0;  // WTD_REVOKE_NONE
            public int dwUnionChoice = 1;        // WTD_CHOICE_FILE
            public IntPtr pFile;
            public int dwStateAction = 0;        // WTD_STATEACTION_IGNORE
            public IntPtr hWVTStateData = IntPtr.Zero;
            public IntPtr pwszURLReference = IntPtr.Zero;
            public int dwProvFlags = 0x10;       // WTD_CACHE_ONLY_URL_RETRIEVAL
            public int dwUIContext = 0;
            public IntPtr pSignatureSettings = IntPtr.Zero;
        }

        [DllImport("wintrust.dll", CharSet = CharSet.Unicode)]
        static extern int WinVerifyTrust(IntPtr hwnd, ref Guid action, WinTrustData data);

        static int TrustResult(string path)
        {
            var action = new Guid("00AAC56B-CD44-11d0-8CC2-00C04FC295EE"); // WINTRUST_ACTION_GENERIC_VERIFY_V2
            var file = new WinTrustFileInfo();
            file.pcwszFilePath = Marshal.StringToCoTaskMemUni(path);
            IntPtr pFile = Marshal.AllocCoTaskMem(Marshal.SizeOf(typeof(WinTrustFileInfo)));
            try
            {
                Marshal.StructureToPtr(file, pFile, false);
                var data = new WinTrustData();
                data.pFile = pFile;
                return WinVerifyTrust(IntPtr.Zero, ref action, data);
            }
            finally
            {
                Marshal.FreeCoTaskMem(pFile);
                Marshal.FreeCoTaskMem(file.pcwszFilePath);
            }
        }

        static string Signer(string path)
        {
            try { return X509Certificate.CreateFromSignedFile(path).Subject; } catch { return ""; }
        }

        static bool IsTrustedVbAudio(string path, out int trust, out string signer)
        {
            trust = TrustResult(path);
            signer = Signer(path);
            return trust == 0 && (signer.IndexOf("Vincent Burel", StringComparison.OrdinalIgnoreCase) >= 0 ||
                                  signer.IndexOf("VB-Audio", StringComparison.OrdinalIgnoreCase) >= 0);
        }

        static string Verify(string path)
        {
            int trust;
            string signer;
            bool ok = IsTrustedVbAudio(path, out trust, out signer);
            return "{\"ok\":" + (ok ? "true" : "false") + ",\"trust\":" + trust + ",\"signer\":" + J(signer) + "}";
        }

        // ------------------------------------------------------------------ driver installer
        static string RunInstaller(string zipPath)
        {
            string dir = Path.Combine(Path.GetTempPath(), "Echopad-VBCABLE-" + Guid.NewGuid().ToString("N"));
            ZipFile.ExtractToDirectory(zipPath, dir);
            bool x64 = Environment.Is64BitOperatingSystem;
            string setup = Path.Combine(dir, x64 ? "VBCABLE_Setup_x64.exe" : "VBCABLE_Setup.exe");
            if (!File.Exists(setup)) return Error("setup program not found in package");

            int trust;
            string signer;
            if (!IsTrustedVbAudio(setup, out trust, out signer))
                return "{\"ok\":false,\"error\":\"signature\",\"trust\":" + trust + ",\"signer\":" + J(signer) + "}";

            // VB-Audio's own, unmodified installer with its own window and license.
            var psi = new ProcessStartInfo(setup)
            {
                UseShellExecute = true,
                Verb = "runas",
                WorkingDirectory = dir
            };
            try
            {
                using (var p = Process.Start(psi))
                {
                    p.WaitForExit();
                    return "{\"ok\":true,\"exitCode\":" + p.ExitCode + ",\"signer\":" + J(signer) + "}";
                }
            }
            catch (Win32Exception ex)
            {
                if (ex.NativeErrorCode == 1223) return "{\"ok\":false,\"error\":\"cancelled\"}";
                return Error(ex.Message);
            }
        }

        // ------------------------------------------------------------------ json
        static string Error(string msg) { return "{\"ok\":false,\"error\":" + J(msg) + "}"; }

        static string J(string s)
        {
            if (s == null) return "null";
            var sb = new StringBuilder("\"");
            foreach (char c in s)
            {
                switch (c)
                {
                    case '"': sb.Append("\\\""); break;
                    case '\\': sb.Append("\\\\"); break;
                    case '\n': sb.Append("\\n"); break;
                    case '\r': sb.Append("\\r"); break;
                    case '\t': sb.Append("\\t"); break;
                    default:
                        if (c < 0x20) sb.Append("\\u").Append(((int)c).ToString("x4"));
                        else sb.Append(c);
                        break;
                }
            }
            return sb.Append('"').ToString();
        }
    }
}
