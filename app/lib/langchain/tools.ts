import { Tool } from "@langchain/core/tools";

// Weather tool example
export class WeatherTool extends Tool {
  name = "weather";
  description = "Get the current weather for a location";
  
  async _call(location: string) {
    // In a real implementation, this would call a weather API
    // For demo purposes, we'll return mock data
    const conditions = ["sunny", "cloudy", "rainy", "snowy"];
    const temperature = Math.floor(Math.random() * 30) + 5; // Random temp between 5-35°C
    
    return `The weather in ${location} is ${conditions[Math.floor(Math.random() * conditions.length)]} with a temperature of ${temperature}°C`;
  }
}

// Calendar tool example
export class CalendarTool extends Tool {
  name = "calendar";
  description = "Check calendar events or schedule new events";
  
  async _call(input: string) {
    // Parse input to determine if checking or scheduling
    if (input.toLowerCase().includes("check")) {
      // In a real implementation, this would check a calendar API
      return "You have a meeting at 2pm with the design team";
    } else if (input.toLowerCase().includes("schedule")) {
      // In a real implementation, this would call a calendar API to schedule
      return `Event "${input.replace('schedule', '').trim()}" scheduled successfully`;
    }
    return "I couldn't understand the calendar request. Try 'check calendar' or 'schedule meeting with John at 3pm'";
  }
}

// Search tool example
export class SearchTool extends Tool {
  name = "search";
  description = "Search the web for information";
  
  async _call(query: string) {
    // In a real implementation, this would call a search API
    return `Here are the search results for "${query}": (1) Wikipedia article about ${query}, (2) Latest news about ${query}, (3) Related topics to ${query}`;
  }
}

// Calculator tool
export class CalculatorTool extends Tool {
  name = "calculator";
  description = "Perform mathematical calculations";
  
  async _call(expression: string) {
    try {
      // CAUTION: Using eval for demo purposes only
      // In production, use a proper math expression parser for security
      // eslint-disable-next-line no-eval
      const result = eval(expression);
      return `The result of ${expression} is ${result}`;
    } catch (error) {
      return `Error calculating ${expression}: ${error instanceof Error ? error.message : String(error)}`;
    }
  }
}

// Export all tools
export const tools = [
  new WeatherTool(),
  new CalendarTool(),
  new SearchTool(),
  new CalculatorTool()
];
