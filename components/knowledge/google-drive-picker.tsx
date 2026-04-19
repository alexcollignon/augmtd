'use client';

import { useState, useCallback } from 'react';
import { FolderArrowDownIcon } from '@heroicons/react/24/outline';

declare global {
  interface Window {
    gapi: {
      load: (api: string, callback: () => void) => void;
      client: {
        init: (config: { apiKey: string }) => Promise<void>;
        setToken: (token: { access_token: string }) => void;
        getToken: () => { access_token: string } | null;
      };
    };
    google: {
      picker: {
        PickerBuilder: new () => GooglePickerBuilder;
        ViewId: { DOCS: string };
        Feature: { MULTISELECT_ENABLED: string };
        Action: { PICKED: string; CANCEL: string };
      };
    };
  }
}

interface GooglePickerBuilder {
  addView: (view: string) => GooglePickerBuilder;
  setOAuthToken: (token: string) => GooglePickerBuilder;
  setDeveloperKey: (key: string) => GooglePickerBuilder;
  setAppId: (appId: string) => GooglePickerBuilder;
  setCallback: (cb: (data: GooglePickerResult) => void) => GooglePickerBuilder;
  enableFeature: (feature: string) => GooglePickerBuilder;
  build: () => { setVisible: (v: boolean) => void };
}

interface GooglePickerResult {
  action: string;
  docs?: Array<{ id: string; name: string; mimeType: string }>;
}

interface GoogleDrivePickerProps {
  connectionId: string;
  onSelect: (fileIds: string[], fileNames: string[]) => void;
  disabled?: boolean;
}

export default function GoogleDrivePicker({ connectionId, onSelect, disabled }: GoogleDrivePickerProps) {
  const [loading, setLoading] = useState(false);

  const openPicker = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/auth/gmail/picker-token?connectionId=${connectionId}`);
      const data = await res.json();
      if (!res.ok || !data.accessToken) throw new Error(data.error ?? 'Failed to get token');

      const accessToken: string = data.accessToken;
      const apiKey = process.env.NEXT_PUBLIC_GOOGLE_PICKER_API_KEY ?? '';
      const appId = process.env.NEXT_PUBLIC_GOOGLE_APP_ID ?? '';

      // Load gapi script if not already present
      await new Promise<void>((resolve) => {
        if (window.gapi) { resolve(); return; }
        const script = document.createElement('script');
        script.src = 'https://apis.google.com/js/api.js';
        script.onload = () => resolve();
        document.body.appendChild(script);
      });

      // Load client:picker — required for drive.file scope to register file access server-side
      await new Promise<void>((resolve) => window.gapi.load('client:picker', resolve));

      // Initialize gapi.client and set the OAuth token — links file selections to our OAuth app
      await window.gapi.client.init({ apiKey });
      window.gapi.client.setToken({ access_token: accessToken });

      const picker = new window.google.picker.PickerBuilder()
        .addView(window.google.picker.ViewId.DOCS)
        .setOAuthToken(accessToken)
        .setDeveloperKey(apiKey)
        .setAppId(appId)
        .enableFeature(window.google.picker.Feature.MULTISELECT_ENABLED)
        .setCallback((result: GooglePickerResult) => {
          if (result.action === window.google.picker.Action.PICKED && result.docs?.length) {
            const fileIds = result.docs.map((d) => d.id);
            const fileNames = result.docs.map((d) => d.name);
            onSelect(fileIds, fileNames);
          }
        })
        .build();

      picker.setVisible(true);
    } catch (err) {
      console.error('[GoogleDrivePicker]', err);
    } finally {
      setLoading(false);
    }
  }, [connectionId, onSelect]);

  return (
    <button
      onClick={openPicker}
      disabled={disabled || loading}
      className="flex items-center gap-2 px-4 py-2.5 border border-neutral-200 bg-white hover:bg-neutral-50 text-[13px] text-neutral-700 font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
    >
      <FolderArrowDownIcon className="w-4 h-4 text-neutral-500" />
      {loading ? 'Opening…' : 'Choose files from Google Drive'}
    </button>
  );
}
