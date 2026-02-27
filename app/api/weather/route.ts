import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    let lat = searchParams.get('lat');
    let lng = searchParams.get('lng');

    // If no lat/lng provided, try IP-based geolocation
    if (!lat || !lng) {
      try {
        const ipResponse = await fetch('https://ipapi.co/json/');
        const ipData = await ipResponse.json();
        if (ipData && ipData.latitude && ipData.longitude) {
          lat = ipData.latitude.toString();
          lng = ipData.longitude.toString();
          console.log('[Weather] Using IP location:', lat, lng);
        }
      } catch (e) {
        console.error('[Weather] IP geolocation failed:', e);
        // Default to Rochester, NY if IP geolocation fails
        lat = '43.1566';
        lng = '-77.6088';
      }
    }

    if (!lat || !lng) {
      return NextResponse.json({ error: 'Location not available' }, { status: 400 });
    }

    // Use Open-Meteo API (free, no API key needed) - get current + hourly
    const weatherUrl = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&current=temperature_2m,weather_code,is_day&hourly=temperature_2m,weather_code&forecast_days=1&temperature_unit=fahrenheit`;

    const response = await fetch(weatherUrl);
    
    if (!response.ok) {
      throw new Error('Weather API error');
    }

    const data = await response.json();
    
    const temp = data.current?.temperature_2m;
    const weatherCode = data.current?.weather_code;
    const isDay = data.current?.is_day;
    
    // Get hourly forecast for today
    const hourlyData = data.hourly;
    const hourly = [];
    const now = new Date();
    const currentHour = now.getHours();
    
    if (hourlyData && hourlyData.time) {
      for (let i = 0; i < hourlyData.time.length; i++) {
        const hourTime = new Date(hourlyData.time[i]);
        if (hourTime.getHours() >= currentHour && hourly.length < 12) { // Next 12 hours
          const hourCode = hourlyData.weather_code[i];
          const hourTemp = hourlyData.temperature_2m[i];
          const hourCond = getWeatherCondition(hourCode, 1);
          hourly.push({
            hour: hourTime.getHours(),
            time: hourTime.toLocaleTimeString('en-US', { hour: 'numeric', hour12: true }),
            temperature: hourTemp,
            condition: hourCond.condition,
            icon: hourCond.icon,
          });
        }
      }
    }
    
    // Map weather codes to conditions
    const conditions = getWeatherCondition(weatherCode, isDay);
    
    return NextResponse.json({
      temperature: temp,
      condition: conditions.condition,
      icon: conditions.icon,
      recommendation: conditions.recommendation,
      weatherCode,
      isDay,
      hourly,
    });

  } catch (error) {
    console.error('Weather API error:', error);
    return NextResponse.json({ error: 'Failed to fetch weather' }, { status: 500 });
  }
}

function getWeatherCondition(code: number, isDay: number) {
  // WMO Weather interpretation codes
  // https://open-meteo.com/en/docs
  
  if (code === 0) {
    return { 
      condition: isDay ? 'Clear' : 'Clear', 
      icon: isDay ? '☀️' : '🌙',
      recommendation: isDay ? "Great day for knocking! ☀️" : "Clear night, good conditions"
    };
  }
  
  if (code === 1 || code === 2) {
    return { 
      condition: 'Partly Cloudy', 
      icon: isDay ? '⛅' : '☁️',
      recommendation: "Good day for knocking! 🌤️"
    };
  }
  
  if (code === 3) {
    return { 
      condition: 'Cloudy', 
      icon: '☁️',
      recommendation: "Decent day for knocking ☁️"
    };
  }
  
  if (code >= 45 && code <= 48) {
    return { 
      condition: 'Foggy', 
      icon: '🌫️',
      recommendation: "Foggy - drive carefully 🌫️"
    };
  }
  
  if (code >= 51 && code <= 57) {
    return { 
      condition: 'Drizzle', 
      icon: '🌧️',
      recommendation: "Light rain - might be slow today 🌧️"
    };
  }
  
  if (code >= 61 && code <= 67) {
    return { 
      condition: 'Rain', 
      icon: '🌧️',
      recommendation: "Rainy day - might want to reschedule 🌧️"
    };
  }
  
  if (code >= 71 && code <= 77) {
    return { 
      condition: 'Snow', 
      icon: '❄️',
      recommendation: "Snow day - stay safe! ❄️"
    };
  }
  
  if (code >= 80 && code <= 82) {
    return { 
      condition: 'Rain Showers', 
      icon: '🌦️',
      recommendation: "Rain showers expected 🌦️"
    };
  }
  
  if (code >= 95) {
    return { 
      condition: 'Thunderstorm', 
      icon: '⛈️',
      recommendation: "Thunderstorms - stay indoors! ⛈️"
    };
  }
  
  return { 
    condition: 'Unknown', 
    icon: '🌤️',
    recommendation: "Check conditions before heading out"
  };
}
