using System;
using System.Runtime.InteropServices;

public static class GuixuSystemVolume
{
    [ComImport, Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"),
     InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IDeviceEnumerator
    {
        void EnumAudioEndpoints(int flow, int mask, out IntPtr devices);
        void GetDefaultAudioEndpoint(int flow, int role, out IDevice device);
    }

    [ComImport, Guid("D666063F-1587-4E43-81F1-B948E807363F"),
     InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IDevice
    {
        void Activate(ref Guid interfaceId, int context, IntPtr parameters,
            [MarshalAs(UnmanagedType.IUnknown)] out object instance);
    }

    [ComImport, Guid("5CDF2C82-841E-4546-9722-0CF74078229A"),
     InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IEndpointVolume
    {
        void RegisterControlChangeNotify(IntPtr callback);
        void UnregisterControlChangeNotify(IntPtr callback);
        void GetChannelCount(out uint channels);
        void SetMasterVolumeLevel(float decibels, ref Guid context);
        void SetMasterVolumeLevelScalar(float level, ref Guid context);
        void GetMasterVolumeLevel(out float decibels);
        void GetMasterVolumeLevelScalar(out float level);
        void SetChannelVolumeLevel(uint channel, float decibels, ref Guid context);
        void SetChannelVolumeLevelScalar(uint channel, float level, ref Guid context);
        void GetChannelVolumeLevel(uint channel, out float decibels);
        void GetChannelVolumeLevelScalar(uint channel, out float level);
        void SetMute([MarshalAs(UnmanagedType.Bool)] bool muted, ref Guid context);
        void GetMute([MarshalAs(UnmanagedType.Bool)] out bool muted);
    }

    public sealed class VolumeState
    {
        public float Level { get; set; }
        public bool Muted { get; set; }
    }

    private static T WithDefaultOutput<T>(Func<IEndpointVolume, T> operation)
    {
        var classId = new Guid("BCDE0395-E52F-467C-8E3D-C4579291692E");
        var enumerator = (IDeviceEnumerator)Activator.CreateInstance(Type.GetTypeFromCLSID(classId));
        IDevice device = null;
        object endpoint = null;
        try
        {
            enumerator.GetDefaultAudioEndpoint(0, 1, out device); // eRender, eMultimedia
            var interfaceId = typeof(IEndpointVolume).GUID;
            device.Activate(ref interfaceId, 23, IntPtr.Zero, out endpoint);
            return operation((IEndpointVolume)endpoint);
        }
        finally
        {
            if (endpoint != null) Marshal.ReleaseComObject(endpoint);
            if (device != null) Marshal.ReleaseComObject(device);
            Marshal.ReleaseComObject(enumerator);
        }
    }

    public static VolumeState Read()
    {
        return WithDefaultOutput(volume =>
        {
            float level;
            bool muted;
            volume.GetMasterVolumeLevelScalar(out level);
            volume.GetMute(out muted);
            return new VolumeState { Level = level, Muted = muted };
        });
    }

    public static bool SetLevel(float level)
    {
        return WithDefaultOutput(volume =>
        {
            var context = Guid.Empty;
            volume.SetMasterVolumeLevelScalar(Math.Min(1f, Math.Max(0f, level)), ref context);
            return true;
        });
    }

    public static bool SetMute(bool muted)
    {
        return WithDefaultOutput(volume =>
        {
            var context = Guid.Empty;
            volume.SetMute(muted, ref context);
            return true;
        });
    }
}
