# Scrape flow
## Mobile.de
- Search
- Per car:
    - Title + subtitle
    - Price
    - Month/Year
    - KM
    - Hoursepower
    - Combustivel
    - Open each car:
        - Under Technische Daten get all the data we need:
            - Engine displacement / cilindrada
            - Series
            - Equipment line
            - Emissions class
            - Weight
            - First registation
            - Environmental badge
            - Origin + city

## Autosout24
- Search
- Per car:
    - Title + subtitle
    - Price
    - Month/Year
    - KM
    - Combustivel
    - Hoursepower
    - Open each car:
        - Engine size
        - Emission class
        - Empty weight
        - Origin + City

## Autouncle (Already in Portugal so import costs can be ignored)
- Search
- Per car:
    - Subtitle
    - year
    - KM
    - Combustivel
    - Hoursepower
    - Open each car(ver o carro button):
        - cilindrada

### Notes
- We could also get the title of the car from the list and get the extra information from: 
    - https://cardata.wiki/
        - We download their database and perform fuzzy finding by title
        - We use their developer api (20euros per month)
