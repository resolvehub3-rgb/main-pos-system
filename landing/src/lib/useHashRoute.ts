/**
 * Hash-route subscription for React (browser only).
 * Re-renders when the hash route changes, including back/forward navigation.
 */

import {useEffect, useState} from 'react';
import {parseRoute, type ParsedRoute} from './hashRoute.ts';

function currentRoute(): ParsedRoute {
  return parseRoute(window.location.hash, window.location.search);
}

export function useHashRoute(): ParsedRoute {
  const [route, setRoute] = useState<ParsedRoute>(currentRoute);

  useEffect(() => {
    const onChange = () => setRoute(currentRoute());
    window.addEventListener('hashchange', onChange);
    window.addEventListener('popstate', onChange);
    return () => {
      window.removeEventListener('hashchange', onChange);
      window.removeEventListener('popstate', onChange);
    };
  }, []);

  return route;
}
