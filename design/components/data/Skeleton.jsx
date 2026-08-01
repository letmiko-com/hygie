import React from 'react';
export function Skeleton({width='100%',height=14,radius='var(--r-sm)',style}){
  return <span style={{display:'block',width,height,borderRadius:radius,background:'var(--surface-3)',animation:'hy-shimmer 1.4s var(--ease) infinite',...style}}></span>;
}
