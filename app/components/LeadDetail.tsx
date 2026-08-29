'use client';

import { useState, useEffect } from 'react';
import { format } from 'date-fns';
import { Lead, User, ObjectionType, LeadDispositionHistoryEntry } from '@/app/types';
import { 
  X, MapPin, Phone, Mail, Clock, User as UserIcon, 
  CheckCircle, Circle, AlertCircle, Calendar, DollarSign,
  Home, Star, XCircle, Target, Users as UsersIcon, HelpCircle,
  ThumbsUp, ThumbsDown, Flag, Bookmark, Heart, Pin,
  DoorOpen, DoorClosed, Bell, MessageSquare, FileText, Clipboard,
  Zap, Sun, Cloud, Umbrella, Car, Truck, Building, Briefcase,
  Coffee, Gift, Shield, Lock, Unlock, Key, Trash, Archive,
  Ban, Slash, MinusCircle, PlusCircle, Info, ArrowRight, ArrowLeft
} from 'lucide-react';
import { updateLeadStatus, claimLead, unclaimLead, getUsersAsync } from '@/app/utils/storage';
import ObjectionTracker from './ObjectionTracker';
import LeadEditorModal from './LeadEditorModal';
import { Disposition, getDispositionsAsync } from '@/app/utils/dispositions';
import { checkEasterEggTrigger } from '@/app/utils/easterEggs';
import { awardSolarMadnessAsync } from '@/app/utils/solarMadness';
import { auth } from '@/app/utils/firebase';
import type { SolarMadnessAwardResponse } from '@/app/types/solarMadness';
import SolarMadnessWinModal from './SolarMadnessWinModal';
import { EasterEgg } from '@/app/types/easterEgg';
import EasterEggWinModal from './EasterEggWinModal';
import GoBackScheduleModal, { GoBackScheduleData } from './GoBackScheduleModal';
import { formatGoBackScheduledTime } from '@/app/utils/timezone';
