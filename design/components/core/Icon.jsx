import React from 'react';
export function Icon({name,size=18,color,style}){return <span className="msym" aria-hidden="true" style={{fontSize:size,color,...style}}>{name}</span>;}
