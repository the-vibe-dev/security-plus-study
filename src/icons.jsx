import React from 'react';

export function Icon({ name, size = 22 }) {
  const paths = {
    file: <><path d="M6 2.75h7l5 5V21H6a2 2 0 0 1-2-2V4.75a2 2 0 0 1 2-2Z"/><path d="M13 2.75v5h5M8 12h6M8 16h7"/></>,
    shuffle: <><path d="M3 7h3c3 0 4 10 8 10h6"/><path d="m17 14 3 3-3 3M3 17h3c1.7 0 2.8-2.3 4-4.8M14 7h6m-3-3 3 3-3 3"/></>,
    review: <><path d="M5 3h12a2 2 0 0 1 2 2v16H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z"/><path d="M7 8h8M7 12h4M14.5 16.5l2 2 4-4"/></>,
    arrow: <path d="m9 5 7 7-7 7"/>,
    back: <path d="m15 5-7 7 7 7"/>,
    upload: <><path d="M12 16V4m-4 4 4-4 4 4M4 16v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3"/></>,
    settings: <><circle cx="12" cy="12" r="3"/><path d="M10 2h4l.5 2.2 1.7.7 1.9-1.2 2.8 2.8-1.2 1.9.7 1.7L22 10v4l-2.2.5-.7 1.7 1.2 1.9-2.8 2.8-1.9-1.2-1.7.7L14 22h-4l-.5-2.2-1.7-.7-1.9 1.2-2.8-2.8 1.2-1.9-.7-1.7L2 14v-4l2.2-.5.7-1.7-1.2-1.9 2.8-2.8 1.9 1.2 1.7-.7Z"/></>,
    layers: <><path d="m12 2 9 5-9 5-9-5 9-5ZM3 12l9 5 9-5M3 17l9 5 9-5"/></>,
    up: <path d="m5 15 7-7 7 7"/>,
    down: <path d="m5 9 7 7 7-7"/>,
    home: <><path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1V10Z"/></>,
    pbq: <><rect x="3" y="4" width="18" height="15" rx="2"/><path d="m9 9 3 2.5L9 14m5 0h3M7 22h10"/></>,
    library: <><path d="M5 3h13a2 2 0 0 1 2 2v16H7a3 3 0 0 1-3-3V5a2 2 0 0 1 1-2Z"/><path d="M4 17c0-1.7 1.3-3 3-3h13M8 8h8"/></>,
    search: <><circle cx="11" cy="11" r="7"/><path d="m16.3 16.3 4.2 4.2"/></>,
    close: <path d="M5 5 19 19M19 5 5 19"/>,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}
