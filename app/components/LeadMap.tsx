'use client';

import { useEffect, useRef, useState, useMemo } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import 'leaflet.markercluster/dist/MarkerCluster.css';
import 'leaflet.markercluster/dist/MarkerCluster.Default.css';
import 'leaflet.markercluster';
import { Lead, STATUS_COLORS, STATUS_LABELS, User } from '@/app/types';
import { auth } from '@/app/utils/firebase';
import { RouteWaypoint } from './RouteBuilder';
import { Disposition, getDispositionsAsync } from '@/app/utils/dispositions';
import AddLeadModal from './AddLeadModal';
import { getTerritoriesAsync } from '@/app/utils/territories';
import { findLeadTerritory } from '@/app/utils/territoryAssignment';
import { formatTimeEST } from '@/app/utils/timezone';
